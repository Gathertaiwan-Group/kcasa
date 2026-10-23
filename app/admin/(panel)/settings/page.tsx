/* eslint-disable @typescript-eslint/no-explicit-any */
import { saveSettingsAction } from '../../actions'
import { MediaField } from '@/components/admin/MediaPicker'
import { Notice, type SP } from '@/components/admin/ui'
import { twDateTime } from '@/lib/admin/core'
import { requireAdmin } from '@/lib/admin/session'
import { getSettings } from '@/lib/admin/site-ops'
import { svc } from '@/lib/sb'

export const metadata = { title: '網站設定' }

export default async function Settings({ searchParams }: { searchParams: SP }) {
  await requireAdmin('settings')
  const q = await searchParams
  const rows = await getSettings()
  const s: Record<string, any> = Object.fromEntries(rows.map((r: any) => [r.key, r.value]))
  const pages = (await svc().from('posts').select('id,title').eq('post_type', 'page').eq('status', 'publish').order('title')).data || []
  const t = s.tracking || {}
  const c = s.tracking_custom || {}
  const pending = rows.filter((r: any) => r.value && typeof r.value === 'object' && r.value.pending)
  return (
    <>
      <h1>網站設定</h1>
      <Notice q={q} />
      <form action={saveSettingsAction}>
        <div className="grid2">
          <div>
            <div className="card">
              <h2>一般</h2>
              <label>網站名稱</label>
              <input type="text" name="site_name" defaultValue={s.site_name || ''} className="w100" required />
              <p className="small muted">會同步替換頁面標題、Open Graph 與 Logo 替代文字中的「{s.site_name_original}」。</p>
              <label>網站標語</label>
              <input type="text" name="site_description" defaultValue={s.site_description || ''} className="w100" />
              <label>首頁</label>
              <select name="page_on_front" defaultValue={s.page_on_front || ''} className="w100">
                {pages.map((p: any) => <option key={p.id} value={p.id}>{p.title}（#{p.id}）</option>)}
              </select>
            </div>
            <div className="card">
              <h2>聯絡資訊</h2>
              <div className="grid-cols">
                <div><label>電話</label><input type="text" name="contact_phone" defaultValue={s.contact_phone || ''} className="w100" /></div>
                <div><label>Email</label><input type="email" name="contact_email" defaultValue={s.contact_email || ''} className="w100" /></div>
                <div><label>LINE 連結</label><input type="text" name="contact_line" defaultValue={s.contact_line || ''} className="w100" /></div>
              </div>
              <label>地址</label>
              <input type="text" name="contact_address" defaultValue={s.contact_address || ''} className="w100" />
              <label>社群連結（每行一個）</label>
              <textarea name="social_links" defaultValue={(s.social_links || []).join('\n')} />
              <p className="small muted">電話變更時，頁首／頁尾與 tel: 連結中的「{s.contact_phone_original}」會自動替換。</p>
            </div>
            <div className="card">
              <h2>追蹤碼</h2>
              <label className="inline"><input type="checkbox" name="tracking_enabled" defaultChecked={c.enabled !== false} /> 啟用自訂追蹤碼（下方 head / body 程式碼）</label>
              <div className="grid-cols">
                <div><label>Google Tag Manager</label><input type="text" name="gtm" defaultValue={t.gtm?.[0] || ''} placeholder="GTM-XXXXXXX" className="w100" /></div>
                <div><label>Google tag（GA4）</label><input type="text" name="google_tag" defaultValue={t.google_tag?.ids?.[0] || ''} placeholder="G-XXXXXXX / GT-XXXXXXX" className="w100" /></div>
                <div><label>Google Ads</label><input type="text" name="google_ads" defaultValue={t.google_ads?.ids?.[0] || ''} placeholder="AW-XXXXXXXXX" className="w100" /></div>
                <div><label>AdSense 發布商 ID</label><input type="text" name="adsense" defaultValue={t.adsense?.publisher_id || ''} placeholder="ca-pub-…" className="w100" /></div>
              </div>
              <p className="small muted">舊站原本的代碼：GTM {t.original?.gtm || '—'}、Google tag {t.original?.google_tag || '—'}、Ads {t.original?.google_ads || '—'}、AdSense {t.original?.adsense || '—'}。修改後前台會改用新代碼。</p>
              <label>&lt;head&gt; 內加入的程式碼</label>
              <textarea name="head_html" className="code" defaultValue={c.head_html || ''} placeholder="<!-- 例如 Meta Pixel、驗證標籤 -->" />
              <label>&lt;/body&gt; 前加入的程式碼</label>
              <textarea name="body_html" className="code" defaultValue={c.body_html || ''} />
            </div>
            <p><button type="submit" className="primary">儲存設定</button></p>
          </div>
          <div>
            <div className="card">
              <h3>Logo</h3>
              <MediaField name="site_logo_id" initialId={s.site_logo?.media_id ?? null} initialUrl={s.site_logo?.url} label="更換 Logo" />
            </div>
            <div className="card">
              <h3>等待資料庫匯入</h3>
              <p className="small muted">以下外掛設定需要舊站資料庫備份，匯入後會出現在這裡：</p>
              <ul className="small" style={{ paddingLeft: 18 }}>
                {pending.map((r: any) => <li key={r.key}>{r.key}</li>)}
              </ul>
            </div>
            <div className="card">
              <h3>所有設定值</h3>
              {rows.map((r: any) => (
                <details key={r.key}>
                  <summary className="small">{r.key} {r.is_public ? '' : '🔒'} <span className="muted">{twDateTime(r.updated_at)}</span></summary>
                  <pre className="json">{JSON.stringify(r.value, null, 2)}</pre>
                </details>
              ))}
            </div>
          </div>
        </div>
      </form>
    </>
  )
}
