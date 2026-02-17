// Guard against multiple injections
if (!window.__softBlackoutInjected) {
    window.__softBlackoutInjected = true;

    let isRedactionMode = false;

    // ================== UNDO/REDO HISTORY SYSTEM ==================
    const MAX_HISTORY_SIZE = 50; // Limit history to prevent memory issues
    let undoStack = [];
    let redoStack = [];

    // Capture current state of redacted elements
    function captureState() {
        const state = {
            timestamp: Date.now(),
            redactedElements: []
        };

        // Find all redacted spans and their positions
        const redacted = document.querySelectorAll('.blackout-redacted');
        redacted.forEach((el, index) => {
            // Create a unique path to find this element later
            const parent = el.parentElement;
            if (!parent) return;

            const siblings = Array.from(parent.childNodes);
            const nodeIndex = siblings.indexOf(el);

            state.redactedElements.push({
                parentPath: getElementPath(parent),
                nodeIndex: nodeIndex,
                text: el.textContent,
                outerHTML: el.outerHTML
            });
        });

        return state;
    }

    // Get a CSS-like path to an element
    function getElementPath(element) {
        if (!element || element === document.body) return 'body';

        const path = [];
        let current = element;

        while (current && current !== document.body && current !== document.documentElement) {
            let selector = current.tagName.toLowerCase();

            if (current.id) {
                selector += `#${current.id}`;
                path.unshift(selector);
                break; // ID is unique, stop here
            } else {
                // Add nth-child for specificity
                const parent = current.parentElement;
                if (parent) {
                    const siblings = Array.from(parent.children);
                    const index = siblings.indexOf(current) + 1;
                    selector += `:nth-child(${index})`;
                }
                path.unshift(selector);
            }

            current = current.parentElement;
        }

        return path.join(' > ');
    }

    // Save state before an action
    function saveStateForUndo() {
        const state = captureState();
        undoStack.push(state);

        // Limit history size
        if (undoStack.length > MAX_HISTORY_SIZE) {
            undoStack.shift();
        }

        // Clear redo stack when new action is performed
        redoStack = [];
    }

    // Restore a saved state
    function restoreState(state) {
        // First, remove all current redactions
        const currentRedacted = document.querySelectorAll('.blackout-redacted');
        currentRedacted.forEach(el => {
            const text = el.textContent;
            const textNode = document.createTextNode(text);
            el.parentNode.replaceChild(textNode, el);
        });

        // Normalize to clean up text nodes
        document.body.normalize();

        // If state has redacted elements, restore them
        if (state.redactedElements.length > 0) {
            // This is a simplified restoration - we recreate the redaction spans
            // by finding text content and wrapping it
            state.redactedElements.forEach(info => {
                try {
                    const parent = document.querySelector(info.parentPath);
                    if (!parent) return;

                    // Find the text content within parent
                    const walker = document.createTreeWalker(
                        parent,
                        NodeFilter.SHOW_TEXT,
                        null
                    );

                    let node;
                    while (node = walker.nextNode()) {
                        if (node.textContent.includes(info.text)) {
                            const idx = node.textContent.indexOf(info.text);
                            if (idx >= 0) {
                                // Split and wrap
                                let current = node;
                                if (idx > 0) {
                                    current = current.splitText(idx);
                                }
                                if (info.text.length < current.textContent.length) {
                                    current.splitText(info.text.length);
                                }

                                const span = document.createElement('span');
                                span.className = 'blackout-redacted';
                                current.parentNode.insertBefore(span, current);
                                span.appendChild(current);
                                break;
                            }
                        }
                    }
                } catch (e) {
                    console.warn('Could not restore redaction:', e);
                }
            });
        }
    }

    // Undo last action
    function performUndo() {
        if (undoStack.length === 0) {
            return { success: false, message: 'Nothing to undo' };
        }

        // Save current state to redo stack
        const currentState = captureState();
        redoStack.push(currentState);

        // Get and apply previous state
        const previousState = undoStack.pop();
        restoreState(previousState);

        return {
            success: true,
            canUndo: undoStack.length > 0,
            canRedo: redoStack.length > 0
        };
    }

    // Redo last undone action
    function performRedo() {
        if (redoStack.length === 0) {
            return { success: false, message: 'Nothing to redo' };
        }

        // Save current state to undo stack
        const currentState = captureState();
        undoStack.push(currentState);

        // Get and apply redo state
        const redoState = redoStack.pop();
        restoreState(redoState);

        return {
            success: true,
            canUndo: undoStack.length > 0,
            canRedo: redoStack.length > 0
        };
    }

    // Get current history status
    function getHistoryStatus() {
        return {
            canUndo: undoStack.length > 0,
            canRedo: redoStack.length > 0,
            undoCount: undoStack.length,
            redoCount: redoStack.length
        };
    }

    // ================== END UNDO/REDO SYSTEM ==================

    // Selector for text-containing elements - expanded to cover more text
    const TEXT_ELEMENT_SELECTOR = 'p, article, section, div, li, td, th, blockquote, figcaption, dt, dd, span, h1, h2, h3, h4, h5, h6, label, strong, em, b, i, mark, small, cite, time, address, caption, a, button';

    // Elements to skip (usually contain code, scripts, or are interactive)
    const SKIP_ELEMENTS = new Set([
        'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED',
        'INPUT', 'TEXTAREA', 'SELECT',
        'CODE', 'PRE', 'KBD', 'SAMP', 'VAR',
        'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'IMG'
    ]);

    // Elements to skip for Blackout All (links are allowed)
    const SKIP_ELEMENTS_BLACKOUT_ALL = new Set([
        'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED',
        'INPUT', 'TEXTAREA', 'SELECT',
        'CODE', 'PRE', 'KBD', 'SAMP', 'VAR',
        'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'IMG'
    ]);

    // Check if an element should be skipped
    function shouldSkipElement(element) {
        if (!element || !element.tagName) return true;
        if (SKIP_ELEMENTS.has(element.tagName)) return true;
        if (element.isContentEditable) return true;
        if (element.classList.contains('blackout-redacted')) return true;
        // Skip if it's inside a code block or similar
        if (element.closest('pre, code, script, style')) return true;
        return false;
    }

    // Get all text-containing elements, filtering nested ones
    function getTextElements() {
        const elements = document.querySelectorAll(TEXT_ELEMENT_SELECTOR);
        const result = [];

        elements.forEach(el => {
            // Skip if element is inside another selected element (avoid double processing)
            let isNested = false;
            for (const parent of result) {
                if (parent.contains(el) && parent !== el) {
                    isNested = true;
                    break;
                }
            }

            // Only process if not nested and not skipped
            if (!isNested && !shouldSkipElement(el)) {
                // Include if element has any text content
                if (el.innerText && el.innerText.trim().length > 0) {
                    result.push(el);
                }
            }
        });

        return result;
    }

    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        // Ping response for injection detection
        if (request.action === "ping") {
            sendResponse({ pong: true, ...getHistoryStatus() });
            return true;
        }

        if (request.action === "toggleRedaction") {
            if (request.enabled) {
                enableRedaction();
            } else {
                disableRedaction();
            }
            sendResponse({ success: true, ...getHistoryStatus() });
        } else if (request.action === "autoRedact") {
            saveStateForUndo(); // Save state before operation
            const settings = {
                intensity: request.intensity || 0.5,
                mode: request.mode || 'poetry',
                keepProperNouns: request.keepProperNouns !== false,
                keepLongWords: request.keepLongWords !== false,
                keepNumbers: request.keepNumbers || false
            };
            const count = applyAutoRedaction(settings);
            sendResponse({ success: true, redactedElements: count, ...getHistoryStatus() });
        } else if (request.action === "redactAll") {
            saveStateForUndo(); // Save state before operation
            const count = applyRedactAll();
            sendResponse({ success: true, redactedElements: count, ...getHistoryStatus() });
        } else if (request.action === "reset") {
            saveStateForUndo(); // Save state before operation
            const count = resetRedaction();
            sendResponse({ success: true, restoredElements: count, ...getHistoryStatus() });
        } else if (request.action === "undo") {
            const result = performUndo();
            sendResponse({ ...result, ...getHistoryStatus() });
        } else if (request.action === "redo") {
            const result = performRedo();
            sendResponse({ ...result, ...getHistoryStatus() });
        } else if (request.action === "getHistoryStatus") {
            sendResponse(getHistoryStatus());
        }

        return true; // Keep message channel open for async response
    });

    function applyRedactAll() {
        const elements = getTextElements();
        let totalRedacted = 0;

        // Custom skip check for Blackout All (includes links)
        function shouldSkipForBlackoutAll(element) {
            if (!element || !element.tagName) return true;
            if (SKIP_ELEMENTS_BLACKOUT_ALL.has(element.tagName)) return true;
            if (element.isContentEditable) return true;
            if (element.classList.contains('blackout-redacted')) return true;
            if (element.closest('pre, code, script, style')) return true;
            return false;
        }

        elements.forEach(el => {
            if (el.innerText.trim().length === 0) return;

            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
                acceptNode: (node) => {
                    // Skip if parent should be skipped (but allow links)
                    if (shouldSkipForBlackoutAll(node.parentElement)) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    // Skip if already redacted
                    if (node.parentElement.classList.contains('blackout-redacted')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            });

            const nodes = [];
            while (walker.nextNode()) {
                nodes.push(walker.currentNode);
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
                        totalRedacted++;
                    }
                });

                node.parentNode.replaceChild(fragment, node);
            });
        });

        return totalRedacted;
    }

    function applyAutoRedaction(settings = {}) {
        const {
            intensity = 0.5,
            mode = 'poetry',
            keepProperNouns = true,
            keepLongWords = true,
            keepNumbers = false
        } = settings;

        const elements = getTextElements();
        let totalRedacted = 0;

        // Mode-specific parameters
        let baseMinGap, minWordLength, showChance;

        switch (mode) {
            case 'privacy':
                // Privacy mode: Hide private information, keep common words
                baseMinGap = 2;
                minWordLength = 3;
                showChance = 0.7; // Show more common words
                break;
            case 'random':
                // Random mode: Pure randomness based on intensity
                baseMinGap = 1;
                minWordLength = 2;
                showChance = 1 - intensity;
                break;
            case 'poetry':
            default:
                // Poetry mode: Smart selection with leapfrog
                baseMinGap = Math.floor(intensity * 10) + 1;
                minWordLength = keepLongWords ? 4 : 2;
                showChance = 1 - intensity;
                break;
        }

        // Regex patterns
        const properNounPattern = /^[\P{L}]*[\p{Lu}]/u;
        const numberPattern = /\d/;

        elements.forEach(el => {
            // Skip if empty
            if (el.innerText.trim().length === 0) return;

            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
                acceptNode: (node) => {
                    if (shouldSkipElement(node.parentElement)) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            });

            const nodes = [];
            while (walker.nextNode()) nodes.push(walker.currentNode);

            nodes.forEach(node => {
                const text = node.textContent;
                if (!text.trim()) return;

                const parts = text.split(/(\s+)/);
                const fragment = document.createDocumentFragment();

                let redactedBuffer = "";
                let wordsSinceLastVisible = 0;
                let minGap = baseMinGap;

                parts.forEach(part => {
                    // Whitespace handling
                    if (/^\s+$/.test(part)) {
                        if (redactedBuffer.length > 0) {
                            redactedBuffer += part;
                        } else {
                            fragment.appendChild(document.createTextNode(part));
                        }
                        return;
                    }

                    let shouldRedact = true;

                    // Check word properties
                    const isProper = properNounPattern.test(part);
                    const hasNumber = numberPattern.test(part);
                    const isLongWord = part.length >= minWordLength;

                    // Mode-specific logic
                    if (mode === 'privacy') {
                        // Privacy: Redact proper nouns and numbers (private information)
                        if (isProper || hasNumber) {
                            shouldRedact = true;
                        } else if (part.length < 4) {
                            shouldRedact = false; // Keep small common words
                        } else {
                            shouldRedact = Math.random() > showChance;
                        }
                    } else if (mode === 'random') {
                        // Random: Pure chance based on intensity
                        shouldRedact = Math.random() > showChance;
                    } else {
                        // Poetry mode: Smart leapfrog
                        // 1. Keep proper nouns if setting enabled
                        if (isProper && keepProperNouns) {
                            shouldRedact = false;
                            wordsSinceLastVisible = 0;
                            minGap = Math.floor(Math.random() * 3) + baseMinGap;
                        }
                        // 2. Keep numbers if setting enabled
                        else if (hasNumber && keepNumbers) {
                            shouldRedact = false;
                            wordsSinceLastVisible = 0;
                        }
                        // 3. Redact short words
                        else if (!isLongWord && keepLongWords) {
                            shouldRedact = true;
                        }
                        // 4. Distance check
                        else if (wordsSinceLastVisible < minGap) {
                            shouldRedact = true;
                            if (Math.random() > 0.8) minGap = Math.floor(Math.random() * 3) + baseMinGap;
                        }
                        // 5. Random selection
                        else {
                            if (Math.random() < showChance) {
                                shouldRedact = false;
                                wordsSinceLastVisible = 0;
                                minGap = Math.floor(Math.random() * 3) + baseMinGap;
                            }
                        }
                    }

                    wordsSinceLastVisible++;

                    if (shouldRedact) {
                        redactedBuffer += part;
                        totalRedacted++;
                    } else {
                        // Flush buffer
                        if (redactedBuffer.length > 0) {
                            const span = document.createElement('span');
                            span.className = 'blackout-redacted';
                            span.textContent = redactedBuffer;
                            fragment.appendChild(span);
                            redactedBuffer = "";
                        }
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

        return totalRedacted;
    }

    function resetRedaction() {
        const redactedElements = document.querySelectorAll('.blackout-redacted');
        let count = redactedElements.length;

        redactedElements.forEach(el => {
            const text = el.textContent;
            const textNode = document.createTextNode(text);
            el.parentNode.replaceChild(textNode, el);
        });

        // Normalize text nodes to merge adjacent ones
        document.body.normalize();

        return count;
    }

    function handlePreventClick(e) {
        if (isRedactionMode && e.target.closest('a, button')) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    function enableRedaction() {
        isRedactionMode = true;
        document.body.classList.add('blackout-mode-active');
        document.addEventListener('mouseup', handleSelection);
        document.addEventListener('click', handlePreventClick, true);
    }

    function disableRedaction() {
        isRedactionMode = false;
        document.body.classList.remove('blackout-mode-active');
        document.removeEventListener('mouseup', handleSelection);
        document.removeEventListener('click', handlePreventClick, true);
    }

    // Global double-click listener for un-redacting
    document.addEventListener('dblclick', (e) => {
        if (e.target.classList.contains('blackout-redacted')) {
            saveStateForUndo(); // Save state before un-redacting
            const text = e.target.textContent;
            const parent = e.target.parentNode;
            const textNode = document.createTextNode(text);
            parent.replaceChild(textNode, e.target);
            // Normalize parent to merge text nodes
            parent.normalize();
        }
    });

    function handleSelection() {
        if (!isRedactionMode) return;

        const selection = window.getSelection();
        if (selection.rangeCount > 0 && !selection.isCollapsed) {
            saveStateForUndo(); // Save state before manual redaction
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
            const text = textNode.textContent;

            // Strategy using splitText to isolate the middle part
            let current = textNode;
            if (start > 0) {
                current = current.splitText(start);
            }
            // current is now the part starting from 'start'
            if (end < text.length) {
                current.splitText(end - start);
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
                    // Skip nodes in elements we should skip
                    if (shouldSkipElement(node.parentElement)) {
                        return NodeFilter.FILTER_REJECT;
                    }
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

            if (end > start) {
                wrapText(node, start, end);
            }
        });
    }

} // End of injection guard
