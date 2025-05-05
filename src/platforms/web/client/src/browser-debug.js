/**
 * Browser Console Debug Helper
 *
 * This script will output detailed information about script and style loading issues.
 * Include it directly in the HTML before any other scripts.
 */

(function() {
  // Store original console error method
  const originalConsoleError = console.error;
  
  // Override console.error to provide more helpful information for script loading errors
  console.error = function(...args) {
    // Call the original method
    originalConsoleError.apply(console, args);
    
    // Check if this is a script loading error
    const errorString = args.join(' ');
    if (errorString.includes('Unexpected token')) {
      console.log('%c SCRIPT LOADING DEBUG INFO:', 'background: #ff0000; color: white; font-weight: bold; padding: 2px 5px;');
      
      // List all script elements on the page
      const scripts = document.querySelectorAll('script');
      console.log('Scripts on page:', scripts.length);
      scripts.forEach((script, index) => {
        console.log(`Script ${index + 1}:`, {
          src: script.src || 'inline',
          type: script.type,
          async: script.async,
          defer: script.defer,
          crossOrigin: script.crossOrigin,
          status: script.dataset.loadStatus || 'unknown'
        });
      });
      
      // Check for bundle.js specifically
      const bundleScript = document.querySelector('script[src*="bundle.js"]');
      if (bundleScript) {
        console.log('Bundle script found:', bundleScript.src);
        
        // Try to fetch the bundle manually to see if it's accessible
        fetch(bundleScript.src)
          .then(response => {
            console.log('Bundle fetch response:', response.status, response.statusText);
            return response.text();
          })
          .then(text => {
            console.log('Bundle content starts with:', text.substring(0, 100));
          })
          .catch(err => {
            console.log('Bundle fetch error:', err);
          });
      } else {
        console.log('Bundle script not found on page');
      }
      
      // Check for CSS
      const styleLinks = document.querySelectorAll('link[rel="stylesheet"]');
      console.log('Stylesheets on page:', styleLinks.length);
      styleLinks.forEach((link, index) => {
        console.log(`Stylesheet ${index + 1}:`, {
          href: link.href,
          media: link.media,
          crossOrigin: link.crossOrigin
        });
      });
      
      // Log page URL and base
      const base = document.querySelector('base');
      console.log('Page URL:', window.location.href);
      console.log('Base URL:', base ? base.href : 'none');
    }
  };
  
  // Log page load events
  window.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded event fired');
  });
  
  window.addEventListener('load', () => {
    console.log('Window load event fired');
    console.log('Document readyState:', document.readyState);
  });
  
  // Mark all script elements with their load status
  document.addEventListener('DOMContentLoaded', () => {
    const scripts = document.querySelectorAll('script');
    scripts.forEach(script => {
      script.dataset.loadStatus = 'loaded';
    });
  });
})(); 