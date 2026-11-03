import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { initServer } from './server/repository'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

// Which server to talk to is chosen at runtime; everything that fetches needs it first.
void initServer().then(() =>
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
)
