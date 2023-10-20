const fs = require('fs').promises;
const TurndownService = require('turndown');
const { JSDOM } = require('jsdom');


exports.ensureDirectoryExists = async function(directory) {
    try {
        await fs.access(directory);
    } catch (e) {
        await fs.mkdir(directory);
    }
}

exports.readHtmlFile = async function (filePath) {
    return await fs.readFile(filePath, 'utf8');
}

exports.writeToFile = async function (filePath, data, completed, totalItems, errorMessages) {
    await fs.writeFile(filePath, data, 'utf8');
    // Overwrite previous log here
    process.stdout.clearLine();
    process.stdout.moveCursor(0,-1);
    process.stdout.clearLine();
    process.stdout.cursorTo(0);
    console.log(`File ${filePath} written successfully!`);
    exports.printProgressBar(completed, totalItems, completed, totalItems, errorMessages);
}

exports.printProgressBar = function (completed, totalItems, errorMessages) {
    const length = 50;
    const position = Math.floor((completed / totalItems) * length);
    const progressBar = Array(length).fill('-');
    for (let i = 0; i < position; i++) {
        progressBar[i] = '#';
    }

    // Move cursor to where error messages start
    process.stdout.moveCursor(0, -errorMessages.length);

    // Clear lines for existing error messages
    errorMessages.length && errorMessages.forEach(() => {
        process.stdout.clearLine();
        process.stdout.moveCursor(0, 1);
    });

    // Rewind cursor back to start
    process.stdout.moveCursor(0, -errorMessages.length);

    // Print error messages
    errorMessages.length && errorMessages.forEach((msg) => console.log(msg));

    // Print the new progress bar
    process.stdout.clearLine();
    process.stdout.cursorTo(0);
    process.stdout.write(`[${progressBar.join('')}] ${completed}/${totalItems}`);
};

exports.turnDownService = () => {
    const turndownService = new TurndownService();

    turndownService.addRule('removeEmptyTables', {
        filter: function (node) {
            // Check if the node is a table
            if (node.nodeName === 'TABLE') {
                const tds = node.querySelectorAll('td');
                // Check if every <td> has empty text content or only empty <li> tags
                return Array.from(tds).every(td => {
                    const lis = td.querySelectorAll('li');
                    if (lis.length > 0) {
                        return Array.from(lis).every(li => li.textContent.trim() === '');
                    } else {
                        return td.textContent.trim() === '';
                    }
                });
            }
            return false;
        },
        replacement: function (content) {
            return '';  // Return empty string to remove the table
        }
    });

    // Rule to remove empty elements
    turndownService.addRule('removeEmpty', {
        filter: function (node) {
            return node.textContent.trim() === '';
        },
        replacement: function (content) {
            return '';
        }
    });

    turndownService.addRule('tables', {
        filter: 'table',
        replacement: function (content, node) {
            const output = [];

            const processSection = function(section, isThead) {
                const rows = Array.from(section.querySelectorAll('tr'));
                const headerIndices = [];

                // Find all header rows first
                rows.forEach((row, rowIndex) => {
                    const columns = Array.from(row.querySelectorAll('td, th'));
                    if (columns.every(col => col.tagName.toLowerCase() === 'th')) {
                        headerIndices.push(rowIndex);
                    }
                });

                const lastHeaderIndex = headerIndices.length ? headerIndices.pop() : -1;

                // Now loop again to process
                rows.forEach((row, rowIndex) => {
                    const columns = Array.from(row.querySelectorAll('td, th'));
                    const isHeader = columns.every(col => col.tagName.toLowerCase() === 'th');

                    if (isHeader && rowIndex !== lastHeaderIndex) {
                        output.push('### | ' + exports.processColumns(columns) + ' |');
                    } else if (isHeader && rowIndex === lastHeaderIndex) {
                        output.push('| ' + exports.processColumns(columns) + ' |');
                        output.push('|' + columns.map(() => '---').join(' | ') + '|');
                    } else {
                        output.push('| ' + exports.processColumns(columns) + ' |');
                    }
                });
            };

            ['thead', 'tbody'].forEach((tag) => {
                const section = node.querySelector(tag);
                if (section) {
                    processSection(section, tag === 'thead');
                }
            });

            if (!node.querySelector('thead') && !node.querySelector('tbody')) {
                processSection(node, false);
            }

            return output.join('\n');
        }
    });

    return turndownService
}

exports.processListItems = function (content) {
    content = content.replace(/<li>/g, '- ').replace(/<\/li>/g, '');
    if (content.includes('<ul>')) {
        content = content.replace(/<ul>/g, '').replace(/<\/ul>/g, '').split('\n').map(line => '  ' + line).join('\n');
        return exports.processListItems(content);
    }
    return content;
}

exports.processColumns = function (columns) {
    return columns.map(function (column) {
        let content = exports.processListItems(column.innerHTML.trim());

        // Convert <br> tags to new lines
        content = content.replace(/<br\s*\/?>/g, '\n');

        // Clean up unwanted tags
        content = content.replace(/<p.*?>|<\/p>|<ul>|<\/ul>/g, '');

        return content.trim();
    }).join(' | ');
}

exports.processFile = async function ({inputFilePath, outputHTMLFilePath, outputMDFilePath, completed, totalItems, errorMessages, cleanHTML}) {

    const turndownService = exports.turnDownService();

    // Parse the HTML and get the outputs for each step
    const htmlData = await exports.readHtmlFile(inputFilePath);
    const html_clean = cleanHTML(htmlData);

    await exports.writeToFile(outputHTMLFilePath, html_clean, completed, totalItems, errorMessages);

    // Convert the final step to markdown
    const { document } = (new JSDOM(html_clean)).window;
    const markdown = turndownService.turndown(document.body);

    await exports.writeToFile(outputMDFilePath, markdown, completed, totalItems, errorMessages);
}
