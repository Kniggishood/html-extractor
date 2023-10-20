const fs = require('fs').promises;
const TurndownService = require('turndown');

const { JSDOM } = require('jsdom');
const path = require('path');
const {ensureDirectoryExists, processFile, printProgressBar} = require("./src/lib/utils");

const inputFolder = './src/data/input/html';
const outputMDFolder = './src/data/output/markdown';
const outputHTMLFolder = './src/data/output/html';

function cleanHTML(inputHtml) {
    const dom = new JSDOM(inputHtml);
    const { document } = dom.window;

    const mappings = {
        'merkspruch': '!MS!',
        'merke': '!MK!',
        'cave': '!CV!',
        'wichtig': '!WI!',
        'highlight': '!HL!'
    };

    // Step 0: Remove references
    document.querySelector('div.footer') && document.querySelector('div.footer').remove();

    // Step 1: Remove tags that are hard for language models to interpret
    document.querySelectorAll('img, svg, sup').forEach(element => {
        element.remove();
    });

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

    // Step 3: Remove attributes from tags that don't match [data-type="${key}"]
    document.querySelectorAll('*').forEach(element => {
        for (let attr of Array.from(element.attributes)) {
            if (attr.name !== 'data-type' || !mappings.hasOwnProperty(element.getAttribute('data-type'))) {
                element.removeAttribute(attr.name);
            }
        }
    });

    // Step 4.1: Preserve the closing tag for elements with data-type attribute
    // Skipped due to complexity. For a robust solution, you might want to utilize a custom DOM traversal/parsing.

    // Step 4.2: Remove non-structural tags without data-type attribute
    document.querySelectorAll('span:not([data-type]), a:not([data-type])').forEach(element => {
        element.replaceWith(document.createTextNode(element.textContent));
    });

    // Step 5: Replace span[data-type] tags with mapped text
    Object.keys(mappings).forEach(key => {
        document.querySelectorAll(`span[data-type="${key}"]`).forEach(span => {
            const highlightedText = `${mappings[key]} ${span.textContent} ${mappings[key]}`;
            span.replaceWith(document.createTextNode(highlightedText));
        });
    });

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

    return dom.serialize();
}

// Main function
(async () => {
    const errorMessages = [];

    await ensureDirectoryExists(outputHTMLFolder);
    await ensureDirectoryExists(outputMDFolder);

    // Read all files in the input folder
    const files = await fs.readdir(inputFolder);
    const totalItems = files.length;
    let completed = 0;

    for (const file of files) {
        if (path.extname(file) === '.html') {
            try {
                const inputFilePath = path.join(inputFolder, file);

                const outputHTMLFilePath = path.join(outputHTMLFolder, `${path.basename(file, '.html')}.html`);
                const outputMDFilePath = path.join(outputMDFolder, `${path.basename(file, '.html')}.md`);

                await processFile({
                    inputFilePath,
                    outputHTMLFilePath,
                    outputMDFilePath,
                    completed,
                    totalItems,
                    errorMessages,
                    cleanHTML
                });
            } catch (error) {
                errorMessages.push(`Error: ${error.message}`);
                printProgressBar(completed, totalItems, errorMessages);
            } finally {
                // Update and print the progress bar
                completed++;
            }
        }
    }

    console.log('\nProcessing completed!');
})();
