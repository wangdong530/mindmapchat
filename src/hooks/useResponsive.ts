import { useState, useEffect } from 'react'

export function useResponsive() {
  const [width, setWidth] = useState(window.innerWidth)

  useEffect(() => {
    let timeout: number
    const handler = () => {
      clearTimeout(timeout)
      timeout = window.setTimeout(() => setWidth(window.innerWidth), 150)
    }
    window.addEventListener('resize', handler)
    return () => {
      window.removeEventListener('resize', handler)
      clearTimeout(timeout)
    }
  }, [])

  return {
    width,
    isMobile: width <= 640,
    isTablet: width <= 1024 && width > 640,
    isDesktop: width > 1024,
    isCompact: width <= 1024, // mobile + tablet
  }
}
