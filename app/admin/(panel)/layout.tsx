import Link from 'next/link'
import { logoutAction } from '../actions'
import { can, requireAdmin } from '@/lib/admin/session'

export const dynamic = 'force-dynamic'

const NAV: { grp?: string; href?: string; label?: string; area?: string }[] = [
  { href: '/admin/', label: '控制台' },
  { grp: '內容' },
  { href: '/admin/content/?type=post', label: '文章', area: 'content' },
  { href: '/admin/content/?type=page', label: '頁面', area: 'content' },
  { href: '/admin/content/?type=wp_block', label: '可重用區塊', area: 'content' },
  { href: '/admin/terms/?taxonomy=category', label: '文章分類／標籤', area: 'content' },
  { href: '/admin/media/', label: '媒體庫', area: 'media' },
  { grp: '商店' },
  { href: '/admin/products/', label: '商品', area: 'shop' },
  { href: '/admin/terms/?taxonomy=product_cat', label: '商品分類／標籤', area: 'shop' },
  { href: '/admin/orders/', label: '訂單', area: 'orders' },
  { href: '/admin/customers/', label: '顧客', area: 'orders' },
  { href: '/admin/coupons/', label: '優惠券與折扣', area: 'shop' },
  { grp: '網站' },
  { href: '/admin/menus/', label: '選單', area: 'menus' },
  { href: '/admin/forms/', label: '表單提交', area: 'forms' },
  { href: '/admin/redirects/', label: '轉址', area: 'redirects' },
  { href: '/admin/settings/', label: '網站設定', area: 'settings' },
  { href: '/admin/audit/', label: '稽核紀錄', area: 'audit' },
]

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin()
  return (
    <div className="a-shell">
      <aside className="a-side">
        <Link href="/admin/" className="brand">Kcasa 工富家飾</Link>
        <nav>
          {NAV.filter((n) => !n.area || can(admin.role, n.area)).map((n, i) =>
            n.grp ? (
              <div key={i} className="grp">{n.grp}</div>
            ) : (
              <Link key={i} href={n.href!}>{n.label}</Link>
            ),
          )}
        </nav>
      </aside>
      <main className="a-main">
        <div className="a-top">
          <a href="/" target="_blank" rel="noreferrer">↗ 查看網站</a>
          <span>
            {admin.email}（{admin.role}）{' '}
            <form action={logoutAction}>
              <button type="submit" className="link">登出</button>
            </form>
          </span>
        </div>
        {children}
      </main>
    </div>
  )
}
