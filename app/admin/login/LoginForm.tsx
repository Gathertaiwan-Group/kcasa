'use client'
import { useActionState } from 'react'
import { loginAction } from '../actions'

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, undefined)
  return (
    <form action={action}>
      {state?.error && <div className="notice err">{state.error}</div>}
      <label htmlFor="email">電子郵件</label>
      <input key={state?.email || ''} id="email" name="email" type="email" autoComplete="username" required className="w100" defaultValue={state?.email || ''} />
      <label htmlFor="password">密碼</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required className="w100" />
      <p style={{ marginTop: 16 }}>
        <button type="submit" className="primary" disabled={pending} style={{ width: '100%' }}>
          {pending ? '登入中…' : '登入'}
        </button>
      </p>
    </form>
  )
}
