import ReactDOM from 'react-dom/client'
import '@fontsource-variable/fredoka' // rounded display: titles, numbers, buttons
import '@fontsource-variable/nunito' // rounded text
import App from './App.jsx'
import './index.css'

// No StrictMode: double-invoked effects would double-spawn the physics loop
// and interfere with the CSG geometry cache below.
ReactDOM.createRoot(document.getElementById('root')).render(<App />)
