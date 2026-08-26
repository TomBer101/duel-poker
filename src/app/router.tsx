import { createBrowserRouter } from "react-router-dom";
import App from "../App.tsx";
import { HomeScreen } from "../ui/screens/HomeScreen.tsx";
import { GameScreen } from "../ui/screens/GameScreen.tsx";

export const router = createBrowserRouter([
    {
        path: '/',
        element: <App />,
        children: [
            {index: true, element: <HomeScreen />},
            {path: 'room/:roomId', element: <GameScreen />},
            {path: 'solo', element: <GameScreen />}
        ]
    }
])