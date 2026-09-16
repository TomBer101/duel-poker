import { createBrowserRouter } from "react-router-dom";
import App from "../App.tsx";
import { HomeScreen } from "../ui/screens/HomeScreen.tsx";
import { GameScreen } from "../ui/screens/GameScreen.tsx";
import { LobbyScreen } from "../ui/screens/LobbyScreen.tsx";

export const router = createBrowserRouter([
    {
        path: '/',
        element: <App />,
        children: [
            {index: true, element: <HomeScreen />},
            {path: 'lobby', element: <LobbyScreen />},
            {path: 'lobby/:roomId', element: <LobbyScreen />},
            {path: 'room/:roomId', element: <GameScreen />},
            {path: 'solo', element: <GameScreen />}
        ]
    }
])