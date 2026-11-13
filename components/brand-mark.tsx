'use client'

import Image from 'next/image'

type BrandMarkProps = {
  className?: string
}

export function BrandMark({ className }: BrandMarkProps) {
  return (
    <Image
      src="/friends-app-icon.png"
      alt=""
      aria-hidden="true"
      className={className}
      width={48}
      height={48}
    />
  )
}
