interface FileCaptionProps {
  caption: string | null
  tags: string[]
}

/** The AI caption and tags of an image. Renders nothing while the file is still untagged. */
export function FileCaption({ caption, tags }: FileCaptionProps) {
  if (!caption) return null
  return (
    <div className="text-sm">
      <p>{caption}</p>
      {tags.length > 0 && <p className="text-muted-foreground">{tags.map((tag) => `#${tag}`).join(' ')}</p>}
    </div>
  )
}
