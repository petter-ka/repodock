import { describe, expect, it } from "vitest"
import { RingBuffer } from "./ringBuffer"

describe("RingBuffer", () => {
  it("keeps the newest items once full and counts evictions", () => {
    const buffer = new RingBuffer<number>(3)
    for (let i = 1; i <= 5; i++) buffer.push(i)
    expect(buffer.length).toBe(3)
    expect(buffer.toArray()).toEqual([3, 4, 5])
    expect([buffer.at(0), buffer.at(2), buffer.at(3)]).toEqual([3, 5, undefined])
    expect(buffer.evicted).toBe(2)
  })

  it("never grows past its capacity", () => {
    const buffer = new RingBuffer<number>(100)
    for (let i = 0; i < 100_000; i++) buffer.push(i)
    expect(buffer.length).toBe(100)
    expect(buffer.at(99)).toBe(99_999)
  })

  it("resizes keeping the newest items", () => {
    const buffer = new RingBuffer<number>(4)
    for (let i = 1; i <= 6; i++) buffer.push(i)
    buffer.resize(2)
    expect(buffer.toArray()).toEqual([5, 6])
    expect(buffer.evicted).toBe(4)
    buffer.resize(5)
    buffer.push(7)
    expect(buffer.toArray()).toEqual([5, 6, 7])
  })

  it("filters and retains in order across the wrap point", () => {
    const buffer = new RingBuffer<number>(4)
    for (let i = 1; i <= 6; i++) buffer.push(i)
    expect(buffer.filter((n) => n % 2 === 0)).toEqual([4, 6])
    buffer.retain((n) => n !== 4)
    expect(buffer.toArray()).toEqual([3, 5, 6])
    buffer.clear()
    expect(buffer.length).toBe(0)
  })
})
