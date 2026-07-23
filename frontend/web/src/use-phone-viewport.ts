import { useEffect, useState } from 'react'

const PHONE_QUERY = '(max-width: 767px)'

function matchesPhoneViewport(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia(PHONE_QUERY).matches
  }
  return window.innerWidth <= 767
}

export function usePhoneViewport(): boolean {
  const [isPhone, setIsPhone] = useState(matchesPhoneViewport)

  useEffect(() => {
    if (typeof window === 'undefined') return

    if (typeof window.matchMedia === 'function') {
      const media = window.matchMedia(PHONE_QUERY)
      const update = () => setIsPhone(media.matches)
      update()
      if (media.addEventListener) media.addEventListener('change', update)
      else media.addListener(update)
      return () => {
        if (media.removeEventListener) media.removeEventListener('change', update)
        else media.removeListener(update)
      }
    }

    const update = () => setIsPhone(window.innerWidth <= 767)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return isPhone
}
