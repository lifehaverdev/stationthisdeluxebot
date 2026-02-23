import { h, render } from '@monygroupcorp/microact';
import { route, startRouter } from './router.js';
import { Nav } from './components/Nav.js';
import { Footer } from './components/Footer.js';
import { Landing } from './pages/Landing.js';
import { Pricing } from './pages/Pricing.js';
import { Docs } from './pages/Docs.js';
import './style/main.css';

const app = document.getElementById('app');

// Hostname routing: app subdomain gets the sandbox, main domain gets the marketing site
const isAppSubdomain = window.location.hostname.startsWith('app.') ||
                        window.location.hostname === 'app.localhost';

function renderPage(PageComponent) {
  render(
    h('div', { className: 'site' },
      h(Nav, null),
      h('main', { className: 'page' },
        h(PageComponent, null)
      ),
      h(Footer, null)
    ),
    app
  );
}

// Sandbox renders full-viewport without Nav/Footer chrome
function renderSandbox(SandboxComponent) {
  render(h(SandboxComponent, null), app);
}

if (isAppSubdomain) {
  // App subdomain: sandbox at root, lazy-loaded
  route('/', async () => {
    const { Sandbox } = await import('./pages/Sandbox.js');
    renderSandbox(Sandbox);
  });

  // Spell execution page
  route('/spells/:slug', async () => {
    const { SpellPage } = await import('./pages/SpellPage.js');
    renderPage(SpellPage);
  });
} else {
  // Main domain: marketing site
  route('/', () => renderPage(Landing));
  route('/pricing', () => renderPage(Pricing));
  route('/docs', () => renderPage(Docs));

  // Lazy-load admin (ethers + chart.js are heavy)
  route('/admin', async () => {
    const { Admin } = await import('./pages/Admin.js');
    renderPage(Admin);
  });
}

startRouter();
