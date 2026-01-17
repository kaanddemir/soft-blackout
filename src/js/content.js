let isRedactionMode = false;

// Initialize state
chrome.storage.local.get(['redactionMode'], (result) => {
    if (result.redactionMode) {
        enableRedaction();
    }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "toggleRedaction") {
        if (request.enabled) {
            enableRedaction();
        } else {
            disableRedaction();
        }
    } else if (request.action === "autoRedact") {
        applyAutoRedaction();
    } else if (request.action === "redactAll") {
        applyRedactAll();
    } else if (request.action === "reset") {
        resetRedaction();
    }
});

function applyRedactAll() {
    const paragraphs = document.querySelectorAll('p');

    paragraphs.forEach(p => {
        if (p.innerText.trim().length === 0) return;

        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, null, false);
        const nodes = [];

        while (walker.nextNode()) {
            // Only capture text nodes that are NOT comfortably sitting inside a .blackout-redacted span
            if (!walker.currentNode.parentElement.classList.contains('blackout-redacted')) {
                nodes.push(walker.currentNode);
            }
        }

        nodes.forEach(node => {
            const text = node.textContent;
            if (!text.trim()) return;

            const parts = text.split(/(\s+)/);
            const fragment = document.createDocumentFragment();

            parts.forEach(part => {
                if (/^\s+$/.test(part)) {
                    fragment.appendChild(document.createTextNode(part));
                } else if (part.length > 0) {
                    const span = document.createElement('span');
                    span.className = 'blackout-redacted';
                    span.textContent = part;
                    fragment.appendChild(span);
                }
            });

            node.parentNode.replaceChild(fragment, node);
        });
    });
}

function applyAutoRedaction() {
    const paragraphs = document.querySelectorAll('p');

    paragraphs.forEach(p => {
        if (p.querySelector('.blackout-redacted') || p.innerText.trim().length === 0) return;

        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, null, false);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);

        nodes.forEach(node => {
            const text = node.textContent;
            if (!text.trim()) return;

            const parts = text.split(/(\s+)/);
            const fragment = document.createDocumentFragment();

            let redactedBuffer = "";

            // Leapfrog State
            // We want to force a gap after every visible word.
            // chance: Base probability to keep a word visible if we are allowed to.
            let wordsSinceLastVisible = 0;
            let minGap = 4; // Minimum words to redact between visible ones

            parts.forEach(part => {
                // Whitespace handling: pass through to buffer or fragment
                if (/^\s+$/.test(part)) {
                    if (redactedBuffer.length > 0) {
                        redactedBuffer += part;
                    } else {
                        fragment.appendChild(document.createTextNode(part));
                    }
                    return;
                }

                // Word Logic
                let shouldRedact = true;

                // Check for Proper Noun / Capitalized Word
                // We identify a word as "Proper" if its first alphabetic character is uppercase.
                // This covers cases like "Hello" or "“Hello" or "(Hello)".
                const isProper = /^[\P{L}]*[\p{Lu}]/u.test(part);

                // 1. Priority: Keep Proper Nouns visible
                if (isProper) {
                    shouldRedact = false;
                    wordsSinceLastVisible = 0;
                    minGap = Math.floor(Math.random() * 5) + 3;
                }
                // 2. Filter: Redact small boring words almost always
                else if (part.length < 4) {
                    shouldRedact = true;
                }
                // 3. Distance: If we haven't redacted enough distinct words since the last visible one, force redact
                else if (wordsSinceLastVisible < minGap) {
                    shouldRedact = true;
                    // Randomize gap slightly for natural feel
                    if (Math.random() > 0.8) minGap = Math.floor(Math.random() * 4) + 3;
                }
                // 4. Selection: If constraints met, pick this word to show!
                else {
                    // 80% chance to pick this word if it's long enough, otherwise keep looking
                    if (Math.random() > 0.2) {
                        shouldRedact = false;
                        wordsSinceLastVisible = 0; // Reset counter
                        minGap = Math.floor(Math.random() * 5) + 3; // Reset gap (3 to 7 words)
                    }
                }

                wordsSinceLastVisible++;

                if (shouldRedact) {
                    redactedBuffer += part;
                } else {
                    // Flash buffer
                    if (redactedBuffer.length > 0) {
                        const span = document.createElement('span');
                        span.className = 'blackout-redacted';
                        span.textContent = redactedBuffer;
                        fragment.appendChild(span);
                        redactedBuffer = "";
                    }
                    // Show this word!
                    fragment.appendChild(document.createTextNode(part));
                }
            });

            // Flush remaining
            if (redactedBuffer.length > 0) {
                const span = document.createElement('span');
                span.className = 'blackout-redacted';
                span.textContent = redactedBuffer;
                fragment.appendChild(span);
            }

            node.parentNode.replaceChild(fragment, node);
        });
    });
}

function resetRedaction() {
    const redactedElements = document.querySelectorAll('.blackout-redacted');
    redactedElements.forEach(el => {
        const text = el.textContent;
        const textNode = document.createTextNode(text);
        el.parentNode.replaceChild(textNode, el);
    });
}

function enableRedaction() {
    isRedactionMode = true;
    document.body.classList.add('blackout-mode-active');
    document.addEventListener('mouseup', handleSelection);
}

function disableRedaction() {
    isRedactionMode = false;
    document.body.classList.remove('blackout-mode-active');
    document.removeEventListener('mouseup', handleSelection);
}

// Global double-click listener for un-redacting
document.addEventListener('dblclick', (e) => {
    if (e.target.classList.contains('blackout-redacted')) {
        const text = e.target.textContent;
        const textNode = document.createTextNode(text);
        e.target.parentNode.replaceChild(textNode, e.target);
    }
});

function handleSelection() {
    if (!isRedactionMode) return;

    const selection = window.getSelection();
    if (selection.rangeCount > 0 && !selection.isCollapsed) {
        const range = selection.getRangeAt(0);

        // Attempt to redact robustly by processing text nodes
        redactRange(range);

        selection.removeAllRanges();
    }
}

function redactRange(range) {
    const startNode = range.startContainer;
    const endNode = range.endContainer;
    const startOffset = range.startOffset;
    const endOffset = range.endOffset;

    // Helper to wrap text in a span
    function wrapText(textNode, start, end) {
        const span = document.createElement('span');
        span.className = 'blackout-redacted';

        const text = textNode.textContent;
        const before = text.substring(0, start);
        const selected = text.substring(start, end);
        const after = text.substring(end);

        // We replace the text node with: textNode (before) + span (selected) + textNode (after)
        // Actually simpler: splitText.

        // Strategy using splitText to isolate the middle part
        let current = textNode;
        if (start > 0) {
            current = current.splitText(start);
        }
        // current is now the part starting from 'start'
        if (end < text.length) {
            current.splitText(end - start);
            // The second part is now the 'after', we don't need it. current is just the 'selected' part.
        }

        const wrapper = document.createElement('span');
        wrapper.className = 'blackout-redacted';
        current.parentNode.insertBefore(wrapper, current);
        wrapper.appendChild(current);
    }

    // Find all text nodes within the range
    const iterator = document.createNodeIterator(
        range.commonAncestorContainer,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: (node) => {
                return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            }
        }
    );

    let textNodes = [];
    let currentNode;
    while (currentNode = iterator.nextNode()) {
        textNodes.push(currentNode);
    }

    // Process them
    textNodes.forEach(node => {
        let start = 0;
        let end = node.textContent.length;

        if (node === startNode) {
            start = startOffset;
        }
        if (node === endNode) {
            end = endOffset;
        }

        // Skip empty or purely whitespace nodes if desired, but for redaction, whitespace matters
        if (end > start) {
            wrapText(node, start, end);
        }
    });
}
