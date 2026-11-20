import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { ApiProvider } from './api/ApiContext.tsx';
import { RouteAnnouncerProvider } from './a11y/RouteAnnouncer.tsx';
import '@fortawesome/fontawesome-free/css/all.min.css';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Failed to find the root element to mount to.');
}

createRoot(rootElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <RouteAnnouncerProvider>
        <ApiProvider>
          <App />
        </ApiProvider>
      </RouteAnnouncerProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
