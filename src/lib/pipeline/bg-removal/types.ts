export interface BgRemovalProvider {
  readonly id: string
  /** Raw image bytes in → background-removed cutout bytes (PNG with alpha) out. */
  removeBackground(input: Buffer): Promise<Buffer>
}
