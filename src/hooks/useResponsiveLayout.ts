import { useEffect, useMemo, useState } from 'react';

export type LayoutMode = 'desktop' | 'tablet' | 'mobile';
export type ScreenClass =
  | 'desktop-wide'
  | 'desktop'
  | 'laptop'
  | 'tablet-landscape'
  | 'tablet-portrait'
  | 'mobile-large'
  | 'mobile-small';

export const RESPONSIVE_BREAKPOINTS = {
  mobileSmallMax: 389,
  mobileLargeMax: 767,
  tabletPortraitMax: 899,
  tabletLandscapeMax: 1023,
  laptopMax: 1279,
  desktopWideMin: 1440,
  shortHeightMax: 740,
} as const;

type ResponsiveLayoutState = {
  width: number;
  height: number;
  layoutMode: LayoutMode;
  screenClass: ScreenClass;
  isDesktop: boolean;
  isTablet: boolean;
  isMobile: boolean;
  isMobileSmall: boolean;
  isMobileLarge: boolean;
  isTabletPortrait: boolean;
  isTabletLandscape: boolean;
  isLaptop: boolean;
  isDesktopWide: boolean;
  isTouchDevice: boolean;
  isCompactWidth: boolean;
  isCompactHeight: boolean;
  isLandscape: boolean;
  isPortrait: boolean;
  pagePaddingClass: string;
  sectionGapClass: string;
  contentMaxWidthClass: string;
};

const getWindowLayoutState = (): ResponsiveLayoutState => {
  if (typeof window === 'undefined') {
    return {
      width: 1440,
      height: 900,
      layoutMode: 'desktop',
      screenClass: 'desktop-wide',
      isDesktop: true,
      isTablet: false,
      isMobile: false,
      isMobileSmall: false,
      isMobileLarge: false,
      isTabletPortrait: false,
      isTabletLandscape: false,
      isLaptop: false,
      isDesktopWide: true,
      isTouchDevice: false,
      isCompactWidth: false,
      isCompactHeight: false,
      isLandscape: true,
      isPortrait: false,
      pagePaddingClass: 'px-6 py-6',
      sectionGapClass: 'gap-6',
      contentMaxWidthClass: 'max-w-[1600px]',
    };
  }

  const width = window.innerWidth;
  const height = window.innerHeight;
  const isMobileSmall = width <= RESPONSIVE_BREAKPOINTS.mobileSmallMax;
  const isMobile = width <= RESPONSIVE_BREAKPOINTS.mobileLargeMax;
  const isMobileLarge = width > RESPONSIVE_BREAKPOINTS.mobileSmallMax && width <= RESPONSIVE_BREAKPOINTS.mobileLargeMax;
  const isTabletPortrait = width > RESPONSIVE_BREAKPOINTS.mobileLargeMax && width <= RESPONSIVE_BREAKPOINTS.tabletPortraitMax;
  const isTabletLandscape = width > RESPONSIVE_BREAKPOINTS.tabletPortraitMax && width <= RESPONSIVE_BREAKPOINTS.tabletLandscapeMax;
  const isTablet = isTabletPortrait || isTabletLandscape;
  const isDesktop = !isMobile && !isTablet;
  const isLaptop = width > RESPONSIVE_BREAKPOINTS.tabletLandscapeMax && width <= RESPONSIVE_BREAKPOINTS.laptopMax;
  const isDesktopWide = width >= RESPONSIVE_BREAKPOINTS.desktopWideMin;
  const screenClass: ScreenClass = isMobileSmall
    ? 'mobile-small'
    : isMobileLarge
      ? 'mobile-large'
      : isTabletPortrait
        ? 'tablet-portrait'
        : isTabletLandscape
          ? 'tablet-landscape'
          : isLaptop
            ? 'laptop'
            : isDesktopWide
              ? 'desktop-wide'
              : 'desktop';
  const coarsePointer = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const isTouchDevice = coarsePointer || navigator.maxTouchPoints > 0;
  const isCompactWidth = width < 1280;
  const isCompactHeight = height <= RESPONSIVE_BREAKPOINTS.shortHeightMax;
  const isLandscape = width > height;
  const isPortrait = !isLandscape;
  const pagePaddingClass = isMobile ? 'px-3 py-3' : isTablet ? 'px-4 py-4' : isLaptop ? 'px-5 py-5' : 'px-6 py-6';
  const sectionGapClass = isMobile ? 'gap-3' : isTablet ? 'gap-4' : 'gap-6';
  const contentMaxWidthClass = isDesktopWide
    ? 'max-w-[1680px]'
    : isDesktop
      ? 'max-w-[1480px]'
      : isTablet
        ? 'max-w-[1280px]'
        : 'max-w-full';

  return {
    width,
    height,
    layoutMode: isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop',
    screenClass,
    isDesktop,
    isTablet,
    isMobile,
    isMobileSmall,
    isMobileLarge,
    isTabletPortrait,
    isTabletLandscape,
    isLaptop,
    isDesktopWide,
    isTouchDevice,
    isCompactWidth,
    isCompactHeight,
    isLandscape,
    isPortrait,
    pagePaddingClass,
    sectionGapClass,
    contentMaxWidthClass,
  };
};

export const useResponsiveLayout = () => {
  const [state, setState] = useState<ResponsiveLayoutState>(() => getWindowLayoutState());

  useEffect(() => {
    let frame = 0;
    const update = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => setState(getWindowLayoutState()));
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return useMemo(() => state, [state]);
};

export default useResponsiveLayout;
