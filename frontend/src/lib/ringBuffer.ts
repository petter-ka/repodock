/**
 * Fixed-capacity FIFO. Once full, each push overwrites the oldest item, so
 * memory stays constant however long a process streams output. Reading by
 * index needs no copying, which suits a virtualized list.
 */
export class RingBuffer<T> {
  private items: T[] = []
  private head = 0
  /** total items ever dropped from the front; lets views keep their scroll anchor */
  evicted = 0

  constructor(private cap: number) {
    if (cap < 1) throw new Error("ring buffer capacity must be positive")
  }

  get capacity() {
    return this.cap
  }

  get length() {
    return this.items.length
  }

  push(item: T) {
    if (this.items.length < this.cap) {
      this.items.push(item)
      return
    }
    this.items[this.head] = item
    this.head = (this.head + 1) % this.cap
    this.evicted++
  }

  /** Item at a position counted from the oldest; undefined when out of range. */
  at(index: number): T | undefined {
    if (index < 0 || index >= this.items.length) return undefined
    return this.items[(this.head + index) % this.items.length]
  }

  toArray(): T[] {
    return [...this.items.slice(this.head), ...this.items.slice(0, this.head)]
  }

  filter(keep: (item: T) => boolean): T[] {
    const out: T[] = []
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[(this.head + i) % this.items.length]
      if (keep(item)) out.push(item)
    }
    return out
  }

  /** Changes the capacity, keeping the newest items that fit. */
  resize(capacity: number) {
    if (capacity < 1) throw new Error("ring buffer capacity must be positive")
    const items = this.toArray()
    const dropped = Math.max(0, items.length - capacity)
    this.items = items.slice(dropped)
    this.head = 0
    this.evicted += dropped
    this.cap = capacity
  }

  /** Keeps only the items that pass `keep`, preserving order. */
  retain(keep: (item: T) => boolean) {
    const items = this.toArray()
    this.items = items.filter(keep)
    this.head = 0
    this.evicted += items.length - this.items.length
  }

  clear() {
    this.evicted += this.items.length
    this.items = []
    this.head = 0
  }
}
