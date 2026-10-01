import { useLayoutEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import './theme.css'

export default function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { return localStorage.getItem('intent-theme') === 'dark' ? 'dark' : 'light' }
    catch { return 'light' }
  })
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#181818' : '#ffffff')
    try { localStorage.setItem('intent-theme', theme) } catch { /* The theme still works without storage. */ }
  }, [theme])
  const label = theme === 'light' ? 'Включить тёмную тему' : 'Включить светлую тему'
  return <button className="d-theme-toggle" aria-label={label} title={label} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
    {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
  </button>
}
