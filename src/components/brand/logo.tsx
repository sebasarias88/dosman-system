import { cn } from '@/lib/cn'

type LogoVariant = 'horizontal' | 'vertical' | 'isotype'

const SOURCES: Record<LogoVariant, { src: string; ratio: string }> = {
  horizontal: { src: '/brand/logo-horizontal-current.svg', ratio: 'aspect-[770/221]' },
  vertical: { src: '/brand/logo-vertical-current.svg', ratio: 'aspect-[425/344]' },
  isotype: { src: '/brand/isotype-current.svg', ratio: 'aspect-[172/221]' },
}

/**
 * Official Dosman logo drawn as a mask, so it takes the current text color
 * (white on dark screens, brand gray for accents) from one SVG file.
 */
export function Logo({ variant = 'horizontal', className }: { variant?: LogoVariant; className?: string }) {
  const { src, ratio } = SOURCES[variant]
  return (
    <span
      role="img"
      aria-label="Dosman · Cholao & Coffee"
      className={cn('brand-mask block', ratio, className)}
      style={{ maskImage: `url(${src})`, WebkitMaskImage: `url(${src})` }}
    />
  )
}
