import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

export interface RouteAnnouncerContextValue {
  announce: (text: string) => void;
  registerHeading: (node: HTMLHeadingElement | null) => void;
}

const RouteAnnouncerContext = createContext<RouteAnnouncerContextValue | null>(null);

export function RouteAnnouncerProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [message, setMessage] = useState('');
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const isFirstRender = useRef(true);

  const announce = useCallback((text: string) => {
    setMessage('');
    requestAnimationFrame(() => setMessage(text));
  }, []);

  const registerHeading = useCallback((node: HTMLHeadingElement | null) => {
    headingRef.current = node;
  }, []);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const id = requestAnimationFrame(() => {
      if (headingRef.current) headingRef.current.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [location.pathname]);

  return (
    <RouteAnnouncerContext.Provider value={{ announce, registerHeading }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          margin: '-1px',
          padding: 0,
          border: 0,
          clip: 'rect(0 0 0 0)',
          clipPath: 'inset(50%)',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}
      >
        {message}
      </div>
    </RouteAnnouncerContext.Provider>
  );
}

export function useRouteAnnouncer(): RouteAnnouncerContextValue {
  const ctx = useContext(RouteAnnouncerContext);
  if (!ctx) throw new Error('useRouteAnnouncer must be used within a <RouteAnnouncerProvider>');
  return ctx;
}

export interface PageHeadingProps {
  title: string;
  children?: React.ReactNode;
}

export function PageHeading({ title, children }: PageHeadingProps) {
  const { announce, registerHeading } = useRouteAnnouncer();
  const ref = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    registerHeading(ref.current);
    announce(title);
    if (ref.current) ref.current.focus();
    return () => registerHeading(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  return (
    <h1 ref={ref} tabIndex={-1} style={{ outline: 'none' }}>
      {children ?? title}
    </h1>
  );
}
