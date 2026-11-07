import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Maximize, Minus, Plus, RotateCcw } from 'lucide-react'
import { FileIcon } from './FileIcon'
import type { VfsNode } from '@shared/types'

export function ImageViewer({ node }: { node: VfsNode }): JSX.Element {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragging = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const areaRef = useRef<HTMLDivElement | null>(null)

  const reset = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  useEffect(() => {
    reset()
  }, [node.id, reset])

  const min = 0.25
  const max = 8

  const zoomBy = useCallback(
    (factor: number) => {
      setScale((current) => {
        const next = Math.min(max, Math.max(min, current * factor))
        if (next === 1) setOffset({ x: 0, y: 0 })
        return next
      })
    },
    []
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        zoomBy(1.25)
      } else if (event.key === '-') {
        event.preventDefault()
        zoomBy(0.8)
      } else if (event.key === '0') {
        event.preventDefault()
        reset()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomBy, reset])

  const onWheel = (event: React.WheelEvent): void => {
    if (!event.ctrlKey && Math.abs(event.deltaY) < 2) return
    event.preventDefault()
    zoomBy(event.deltaY < 0 ? 1.12 : 0.89)
  }

  const onMouseDown = (event: React.MouseEvent): void => {
    if (scale <= 1) return
    event.preventDefault()
    dragging.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }
  }

  const onMouseMove = (event: React.MouseEvent): void => {
    const drag = dragging.current
    if (!drag) return
    setOffset({
      x: drag.ox + (event.clientX - drag.x),
      y: drag.oy + (event.clientY - drag.y)
    })
  }

  const endDrag = (): void => {
    dragging.current = null
  }

  if (failed) {
    return (
      <div className="flex flex-col items-center gap-2 text-white/60">
        <FileIcon node={node} size={64} />
        <p className="text-sm">No se pudo cargar la vista previa</p>
      </div>
    )
  }

  return (
    <div className="relative flex h-full w-full flex-col">
      <div
        ref={areaRef}
        onClick={(event) => event.stopPropagation()}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onDoubleClick={() => (scale === 1 ? setScale(2) : reset())}
        className="relative flex flex-1 items-center justify-center overflow-hidden"
        style={{ cursor: scale > 1 ? 'grab' : 'default' }}
      >
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-white/70" />
          </div>
        )}
        <img
          src={`tgfile://full/${node.id}`}
          alt={node.name}
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transition: dragging.current ? 'none' : 'transform 120ms ease-out'
          }}
          className={`max-h-full max-w-full rounded-lg object-contain shadow-2xl transition-opacity duration-200 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      </div>

      <div className="pointer-events-auto mt-3 flex items-center justify-center gap-2 rounded-full bg-black/50 px-3 py-2 text-white backdrop-blur">
        <button
          onClick={() => zoomBy(0.8)}
          className="rounded-full p-1.5 hover:bg-white/15"
          title="Alejar"
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="w-14 text-center text-xs tabular-nums text-white/80">
          {Math.round(scale * 100)}%
        </span>
        <button
          onClick={() => zoomBy(1.25)}
          className="rounded-full p-1.5 hover:bg-white/15"
          title="Acercar"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          onClick={reset}
          className="rounded-full p-1.5 hover:bg-white/15"
          title="Restablecer"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          onClick={() => setScale(1)}
          className="rounded-full p-1.5 hover:bg-white/15"
          title="Ajustar a pantalla"
        >
          <Maximize className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
