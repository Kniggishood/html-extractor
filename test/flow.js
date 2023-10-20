const fs = require('fs').promises;
const TurndownService = require('turndown');

const { JSDOM } = require('jsdom');
const path = require('path');

async function ensureDirectoryExists(directory) {
    try {
        await fs.access(directory);
    } catch (e) {
        await fs.mkdir(directory);
    }
}

async function readHtmlFile(filePath) {
    return await fs.readFile(filePath, 'utf8');
}

async function writeToFile(filePath, data) {
    await fs.writeFile(filePath, data, 'utf8');
    console.log(`File ${filePath} written successfully!`);
}

function cleanHTML(inputHtml) {
    const dom = new JSDOM(inputHtml);
    const { document } = dom.window;
    const stepsOutput = [];

    const mappings = {
        'merkspruch': '!MS!',
        'merke': '!MK!',
        'cave': '!CV!',
        'wichtig': '!WI!',
        'highlight': '!HL!'
    };

    // Step 0: Remove references
    document.querySelector('div.footer') && document.querySelector('div.footer').remove();
    stepsOutput.push({ step: 0, html: dom.serialize() });

    // Step 1: Remove tags that are hard for language models to interpret
    document.querySelectorAll('img, svg, sup').forEach(element => {
        element.remove();
    });
    stepsOutput.push({ step: 1, html: dom.serialize() });

    // Step 2: Preserve High-Yield only
    document.querySelectorAll('p, div, td, li').forEach(parentNode => {
        Array.from(parentNode.childNodes).forEach(node => {
            // Check if the node is a text node and if it's not empty or only whitespace
            if (node.nodeType === 3 && node.nodeValue.trim()) {
                node.remove(); // Remove the text node
            } else if (node.nodeType === 1 && node.tagName === 'SPAN') { // If the node is a span
                if (!node.classList.contains('step-1-condensed') && !node.classList.contains('step-2-condensed')) {
                    node.remove();
                }
            }
        });
    });
    stepsOutput.push({ step: 2, html: dom.serialize() });

    // Step 3: Remove attributes from tags that don't match [data-type="${key}"]
    document.querySelectorAll('*').forEach(element => {
        for (let attr of Array.from(element.attributes)) {
            if (attr.name !== 'data-type' || !mappings.hasOwnProperty(element.getAttribute('data-type'))) {
                element.removeAttribute(attr.name);
            }
        }
    });
    stepsOutput.push({ step: 3, html: dom.serialize() });

    // Step 4.1: Preserve the closing tag for elements with data-type attribute
    // Skipped due to complexity. For a robust solution, you might want to utilize a custom DOM traversal/parsing.

   // Step 4.2: Remove non-structural tags without data-type attribute
    document.querySelectorAll('span:not([data-type]), a:not([data-type])').forEach(element => {
        element.replaceWith(document.createTextNode(element.textContent));
    });
    stepsOutput.push({ step: 4, html: dom.serialize() });

    // Step 5: Replace span[data-type] tags with mapped text
    Object.keys(mappings).forEach(key => {
        document.querySelectorAll(`span[data-type="${key}"]`).forEach(span => {
            const highlightedText = `${mappings[key]} ${span.textContent} ${mappings[key]}`;
            span.replaceWith(document.createTextNode(highlightedText));
        });
    });
    stepsOutput.push({ step: 5, html: dom.serialize() });

    // Step 6: Remove empty <ul> and <li>
    document.querySelectorAll('li, ul').forEach(el => {
        if(el.textContent.trim() === "") el.remove();
    });
    document.querySelectorAll('tr > td').forEach(td => {
        if(td.textContent.trim() === "") {
            td.innerHTML="";
        }
    });
    document.querySelectorAll('table').forEach(table => {
        let allEmpty = Array.from(table.querySelectorAll('td')).every(td => !td.textContent.trim().length);
        if (allEmpty) {
            table.remove();
        }
    });
    document.querySelectorAll('section').forEach(section => {
      const hasKids = Array.from(section.querySelectorAll('ul, p')).some(e => e.textContent.trim().length > 0);
      if(!hasKids) section.remove();
    });

    stepsOutput.push({ step: 6, html: dom.serialize() });

    return stepsOutput;
}

async function processFile(inputFilePath, outputFolder) {

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

    function processListItems(content) {
        content = content.replace(/<li>/g, '- ').replace(/<\/li>/g, '');
        if (content.includes('<ul>')) {
            content = content.replace(/<ul>/g, '').replace(/<\/ul>/g, '').split('\n').map(line => '  ' + line).join('\n');
            return processListItems(content);
        }
        return content;
    }

    function processColumns(columns) {
        return columns.map(function (column) {
            let content = processListItems(column.innerHTML.trim());

            // Convert <br> tags to new lines
            content = content.replace(/<br\s*\/?>/g, '\n');

            // Clean up unwanted tags
            content = content.replace(/<p.*?>|<\/p>|<ul>|<\/ul>/g, '');

            return content.trim();
        }).join(' | ');
    }

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
                        output.push('### | ' + processColumns(columns) + ' |');
                    } else if (isHeader && rowIndex === lastHeaderIndex) {
                        output.push('| ' + processColumns(columns) + ' |');
                        output.push('|' + columns.map(() => '---').join(' | ') + '|');
                    } else {
                        output.push('| ' + processColumns(columns) + ' |');
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


    // Parse the HTML and get the outputs for each step
    const htmlData = await readHtmlFile(inputFilePath);
    const stepsOutput = cleanHTML(htmlData);

    for (const { step, html } of stepsOutput) {
        const outputHtmlFilePath = path.join(outputFolder, `output-step${step}.html`);
        await writeToFile(outputHtmlFilePath, html);
    }

    // Convert the final step to markdown
    const { document } = (new JSDOM(stepsOutput[stepsOutput.length - 1].html)).window;
    const markdown = turndownService.turndown(document.body);

    const outputMarkdownFilePath = path.join(outputFolder, `output-final.md`);
    await writeToFile(outputMarkdownFilePath, markdown);
}

(async () => {
    const inputFilePath = './test/input/sample.html'; // specify the single HTML file's path
    const outputFolder = './test/output';

    await ensureDirectoryExists(outputFolder);

    await processFile(inputFilePath, outputFolder);

    console.log('Processing completed!');
})();
