document.addEventListener('DOMContentLoaded', () => {
    const MANIFEST_URL = '/docs/docs-manifest.json';
    const docsNav = document.getElementById('docs-nav');
    const docsContent = document.getElementById('docs-content');
    const prevLink = document.getElementById('prev-link');
    const nextLink = document.getElementById('next-link');
    const sidebar = document.getElementById('docs-sidebar');
    const openToggle = document.getElementById('sidebar-toggle-open');
    const closeToggle = document.getElementById('sidebar-toggle-close');

    let sections = [];
    let currentSectionIndex = -1;

    async function init() {
        try {
            const response = await fetch(MANIFEST_URL);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            sections = await response.json();
            
            populateNav();
            loadContent();

            window.addEventListener('hashchange', loadContent);
            openToggle.addEventListener('click', () => sidebar.classList.add('open'));
            closeToggle.addEventListener('click', () => sidebar.classList.remove('open'));

        } catch (error) {
            console.error("Failed to load docs manifest:", error);
            docsContent.innerHTML = `<p>Error loading documentation. Please try again later.</p>`;
        }
    }

    function populateNav() {
        docsNav.innerHTML = sections.map(section => 
            `<a href="#${section.id}" id="nav-${section.id}">${section.title}</a>`
        ).join('');

        // Add click listener to close sidebar on mobile after navigation
        docsNav.addEventListener('click', (e) => {
            if (e.target.tagName === 'A' && window.innerWidth <= 1024) {
                sidebar.classList.remove('open');
            }
        });
    }

    async function loadContent() {
        const hashParts = (location.hash.substring(1) || sections[0].id).split('#');
        const sectionId = hashParts[0];
        const subSectionId = hashParts[1];

        currentSectionIndex = sections.findIndex(s => s.id === sectionId);

        if (currentSectionIndex === -1) {
            console.warn(`Section not found for id: ${sectionId}`);
            // redirect to first page
            location.hash = sections[0].id;
            return;
        }

        const section = sections[currentSectionIndex];

        // Render content first
        if (section.special === 'tools-renderer') {
            await renderTools();
        } else {
            await renderMarkdown(section.file);
        }

        // After rendering, handle deep linking
        if (section.special === 'tools-renderer' && subSectionId) {
            setTimeout(() => {
                const toolCard = document.getElementById(`tool-${subSectionId}`);
                if (toolCard) {
                    toolCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    const details = toolCard.querySelector('.tool-details');
                    const button = toolCard.querySelector('.toggle-details-btn');
                    if (details && button && (!details.style.maxHeight || details.style.maxHeight === '0px')) {
                        details.style.maxHeight = details.scrollHeight + 'px';
                        button.textContent = 'Show Less';
                    }
                }
            }, 100);
        }

        updateActiveNav();
        updatePrevNext();
    }

    async function renderMarkdown(filePath) {
        try {
            const response = await fetch(filePath);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const markdown = await response.text();
            docsContent.innerHTML = marked.parse(markdown);
        } catch (error) {
            console.error(`Failed to load markdown file: ${filePath}`, error);
            docsContent.innerHTML = `<p>Error loading content. Please try again later.</p>`;
        }
    }

    async function renderTools() {
        try {
            const response = await fetch('/api/v1/tools');
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const tools = await response.json();
            
            let html = '<h1>Tools</h1>';
            html += '<p>The following tools are available through the API and other integrations.</p>';

            tools.forEach(tool => {
                const commandId = tool.commandName ? tool.commandName.replace('/', '') : tool.toolId;
                html += `
                    <div class="tool-card" id="tool-${commandId}">
                        <div class="tool-header">
                            <h2>${tool.displayName || tool.toolId}</h2>
                            <button class="button button-secondary button-small toggle-details-btn">Show More</button>
                        </div>
                        <div class="command-container">
                            <span class="command">${tool.commandName || 'N/A'}</span>
                            <span class="category">${tool.category || 'uncategorized'}</span>
                        </div>
                        <p>${tool.description || 'No description available.'}</p>
                        <div class="tool-details collapsible">
                            ${renderParamsTable(tool.inputSchema)}
                        </div>
                    </div>
                `;
            });

            docsContent.innerHTML = html;
        } catch (error) {
            console.error('Failed to load tools:', error);
            docsContent.innerHTML = `<p>Error loading tools data. Please try again later.</p>`;
        }
    }

    function renderParamsTable(schema) {
        if (!schema || Object.keys(schema).length === 0) return '';

        let tableHtml = '<h3>Parameters</h3><table class="params-table"><thead><tr><th>Name</th><th>Type</th><th>Default</th><th>Description</th></tr></thead><tbody>';
        
        for (const key in schema) {
            const param = schema[key];
            tableHtml += `
                <tr>
                    <td><code>${param.name}</code></td>
                    <td>${param.type}</td>
                    <td>${param.default !== undefined ? `<code>${param.default}</code>` : 'N/A'}</td>
                    <td>${param.description || ''} ${param.required ? '<strong>(Required)</strong>' : ''}</td>
                </tr>
            `;
        }

        tableHtml += '</tbody></table>';
        return tableHtml;
    }

    function updateActiveNav() {
        document.querySelectorAll('#docs-nav a').forEach(a => a.classList.remove('active'));
        const activeLink = document.getElementById(`nav-${sections[currentSectionIndex].id}`);
        if (activeLink) {
            activeLink.classList.add('active');
        }
    }

    function updatePrevNext() {
        // Previous link
        if (currentSectionIndex > 0) {
            prevLink.style.display = 'inline-block';
            prevLink.href = `#${sections[currentSectionIndex - 1].id}`;
            prevLink.textContent = `← ${sections[currentSectionIndex - 1].title}`;
        } else {
            prevLink.style.display = 'none';
        }

        // Next link
        if (currentSectionIndex < sections.length - 1) {
            nextLink.style.display = 'inline-block';
            nextLink.href = `#${sections[currentSectionIndex + 1].id}`;
            nextLink.textContent = `${sections[currentSectionIndex + 1].title} →`;
        } else {
            nextLink.style.display = 'none';
        }
    }

    docsContent.addEventListener('click', (e) => {
        if (e.target.classList.contains('toggle-details-btn')) {
            const toolCard = e.target.closest('.tool-card');
            const details = toolCard.querySelector('.tool-details');
            const isCollapsed = details.style.maxHeight === '0px' || !details.style.maxHeight;

            if (isCollapsed) {
                details.style.maxHeight = details.scrollHeight + 'px';
                e.target.textContent = 'Show Less';
            } else {
                details.style.maxHeight = '0px';
                e.target.textContent = 'Show More';
            }
        }
    });

    init();
}); 