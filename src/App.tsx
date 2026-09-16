import { Outlet } from 'react-router-dom'
import { FirebaseProvider } from './app/FirebaseProvider'

function App() {
  return (
    <FirebaseProvider>
      <Outlet />
    </FirebaseProvider>
  )
}

export default App