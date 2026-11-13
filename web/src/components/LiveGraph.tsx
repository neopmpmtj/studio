import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { useStore } from '../store/settings'
import { elapsed, getLive } from '../audio/useMicrophone'

const HEIGHT = 320

export default function LiveGraph() {
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = box.current!

    const plot = new uPlot(
      {
        width: el.clientWidth,
        height: HEIGHT,
        legend: { show: false },
        cursor: { show: false },
        scales: {
          x: {
            time: false,
            range: (): [number, number] => [-useStore.getState().settings.windowSeconds, 0],
          },
          y: { range: [0, 1] },
        },
        axes: [
          { stroke: '#9aa4b2', grid: { stroke: '#222a35' }, label: 'seconds ago' },
          { stroke: '#9aa4b2', grid: { stroke: '#222a35' } },
        ],
        series: [{}, { stroke: '#4ade80', width: 2, fill: 'rgba(74,222,128,0.12)' }],
      },
      [[], []],
      el,
    )

    let raf = 0
    const draw = () => {
      const { settings, recording } = useStore.getState()
      if (recording) {
        const now = elapsed()
        const pts = getLive().filter((p) => p.t >= now - settings.windowSeconds)
        plot.setData([
          pts.map((p) => p.t - now),
          pts.map((p) => Math.min(1, p.v * settings.gain)), // gain applied live
        ])
      }
      raf = requestAnimationFrame(draw)
    }
    draw()

    const ro = new ResizeObserver(() => plot.setSize({ width: el.clientWidth, height: HEIGHT }))
    ro.observe(el)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      plot.destroy()
    }
  }, [])

  return <div ref={box} className="graph" />
}
