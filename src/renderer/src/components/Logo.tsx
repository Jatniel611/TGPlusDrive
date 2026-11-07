import { useState } from 'react'

export function Logo({ className = '' }: { className?: string }): JSX.Element {
  const [usePng, setUsePng] = useState(true)
  return (
    <img
      src={usePng ? './logo.png' : './logo.svg'}
      onError={() => setUsePng(false)}
      alt="TGPlusDrive"
      draggable={false}
      className={`select-none object-contain ${className}`}
    />
  )
}
