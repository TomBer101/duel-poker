import { Outlet } from 'react-router-dom'
import { FirebaseProvider } from './app/FirebaseProvider'
import { HelpButton } from './ui/components/HelpButton'

function App() {
  return (
    <FirebaseProvider>
      <Outlet />
      <HelpButton />
    </FirebaseProvider>
  )
}

export default App