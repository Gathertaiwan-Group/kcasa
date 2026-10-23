'use client'
/**
 * WYSIWYG editor for post/page/product HTML. The content is edited inside an iframe that loads the
 * storefront's own theme/plugin stylesheets, so it looks like the live page. An "HTML" tab gives the raw
 * source. The original HTML is submitted untouched unless the user actually edits it.
 */
import { useEffect, useRef, useState } from 'react'
import { MediaPicker, type PickedMedia } from './MediaPicker'

type Props = { name: string; initialHtml: string; cssHrefs?: string[]; bodyClass?: string; minHeight?: number }

const BLOCKS: [string, string][] = [
  ['p', '段落'],
  ['h2', '標題 2'],
  ['h3', '標題 3'],
  ['h4', '標題 4'],
  ['blockquote', '引言'],
  ['pre', '預格式'],
]

export function RichEditor({ name, initialHtml, cssHrefs = [], bodyClass = '', minHeight = 420 }: Props) {
  const [mode, setMode] = useState<'visual' | 'html'>('visual')
  const [picker, setPicker] = useState(false)
  const [src, setSrc] = useState(initialHtml)
  const html = useRef(initialHtml)
  const field = useRef<HTMLTextAreaElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const source = useRef<HTMLTextAreaElement>(null)
  const savedRange = useRef<Range | null>(null)

  const doc = () => frame.current?.contentDocument || null
  const editable = () => doc()?.querySelector<HTMLElement>('.kc-ed') || null

  function sync(v: string) {
    html.current = v
    if (field.current) field.current.value = v
  }

  function fit() {
    const d = doc()
    if (!d || !frame.current) return
    frame.current.style.height = Math.max(minHeight, d.documentElement.scrollHeight + 8) + 'px'
  }

  function mount() {
    const d = doc()
    const ed = editable()
    if (!d || !ed) return
    ed.innerHTML = html.current
    const onInput = () => {
      sync(ed.innerHTML)
      fit()
    }
    ed.addEventListener('input', onInput)
    d.addEventListener('selectionchange', () => {
      const sel = d.getSelection()
      if (sel && sel.rangeCount && ed.contains(sel.anchorNode)) savedRange.current = sel.getRangeAt(0).cloneRange()
    })
    // links inside the editor must not navigate
    ed.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('a')) e.preventDefault()
    })
    setTimeout(fit, 300)
    setTimeout(fit, 1500)
  }

  useEffect(() => {
    if (mode === 'visual') {
      const f = frame.current
      if (f && f.contentDocument?.readyState === 'complete' && editable()) mount()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  function cmd(c: string, v?: string) {
    const d = doc()
    const ed = editable()
    if (!d || !ed) return
    ed.focus()
    if (savedRange.current) {
      const sel = d.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(savedRange.current)
    }
    d.execCommand(c, false, v)
    sync(ed.innerHTML)
    fit()
  }

  function link() {
    const url = window.prompt('連結網址（留空取消）', 'https://')
    if (url && url !== 'https://') cmd('createLink', url)
  }

  function insertMedia(m: PickedMedia) {
    setPicker(false)
    const alt = (m.alt_text || '').replace(/"/g, '&quot;')
    if (m.mime_type.startsWith('image/')) cmd('insertHTML', `<figure class="wp-block-image size-large"><img src="${m.url}" alt="${alt}"${m.width ? ` width="${m.width}" height="${m.height}"` : ''} class="wp-image-${m.id}"/></figure><p></p>`)
    else if (m.mime_type.startsWith('video/')) cmd('insertHTML', `<figure class="wp-block-video"><video controls src="${m.url}"></video></figure><p></p>`)
    else cmd('insertHTML', `<a href="${m.url}">${m.title || m.url}</a>`)
  }

  const head = cssHrefs.map((h) => `<link rel="stylesheet" href="${h.replace(/"/g, '&quot;')}">`).join('')
  const srcDoc = `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8">${head}<style>html,body{background:#fff!important;margin:0}body{padding:16px 20px}.kc-ed{outline:none;min-height:${minHeight - 40}px}.kc-ed img{max-width:100%;height:auto}.elementor-invisible{visibility:visible!important}</style></head><body class="${bodyClass.replace(/"/g, '')}"><div class="entry-content clear kc-ed" contenteditable="true"></div></body></html>`

  return (
    <div className="rte">
      <textarea ref={field} name={name} defaultValue={initialHtml} hidden readOnly />
      <div className="bar">
        <button type="button" className={mode === 'visual' ? 'on' : ''} onClick={() => setMode('visual')} title="所見即所得">視覺</button>
        <button
          type="button"
          className={mode === 'html' ? 'on' : ''}
          onClick={() => {
            setSrc(html.current)
            setMode('html')
          }}
          title="HTML 原始碼"
        >
          HTML
        </button>
        {mode === 'visual' && (
          <>
            <span className="sep" />
            <select aria-label="段落格式" onChange={(e) => { cmd('formatBlock', e.target.value); e.target.value = '' }} defaultValue="" style={{ height: 28, padding: '0 4px' }}>
              <option value="" disabled>格式</option>
              {BLOCKS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button type="button" onClick={() => cmd('bold')} title="粗體"><b>B</b></button>
            <button type="button" onClick={() => cmd('italic')} title="斜體"><i>I</i></button>
            <button type="button" onClick={() => cmd('underline')} title="底線"><u>U</u></button>
            <button type="button" onClick={() => cmd('strikeThrough')} title="刪除線"><s>S</s></button>
            <span className="sep" />
            <button type="button" onClick={() => cmd('insertUnorderedList')} title="項目清單">• 清單</button>
            <button type="button" onClick={() => cmd('insertOrderedList')} title="編號清單">1. 清單</button>
            <button type="button" onClick={() => cmd('justifyLeft')} title="靠左">⇤</button>
            <button type="button" onClick={() => cmd('justifyCenter')} title="置中">↔</button>
            <button type="button" onClick={() => cmd('justifyRight')} title="靠右">⇥</button>
            <span className="sep" />
            <button type="button" onClick={link} title="插入連結">連結</button>
            <button type="button" onClick={() => cmd('unlink')} title="移除連結">取消連結</button>
            <button type="button" onClick={() => setPicker(true)} title="插入圖片/媒體">＋媒體</button>
            <button type="button" onClick={() => cmd('insertHorizontalRule')} title="分隔線">―</button>
            <span className="sep" />
            <button type="button" onClick={() => cmd('removeFormat')} title="清除格式">清除</button>
            <button type="button" onClick={() => cmd('undo')} title="復原">↶</button>
            <button type="button" onClick={() => cmd('redo')} title="重做">↷</button>
          </>
        )}
      </div>
      {mode === 'visual' ? (
        <iframe ref={frame} title="內容編輯器" srcDoc={srcDoc} onLoad={mount} style={{ minHeight }} />
      ) : (
        <textarea ref={source} className="code" value={src} onChange={(e) => { setSrc(e.target.value); sync(e.target.value) }} style={{ minHeight }} spellCheck={false} />
      )}
      {picker && <MediaPicker onPick={insertMedia} onClose={() => setPicker(false)} />}
    </div>
  )
}
