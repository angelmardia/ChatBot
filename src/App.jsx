import React, { useState } from "react";
import CustomChat from "./components/CustomChat";
import { SessionProvider, useSession } from "./SessionContext";
import "./App.css";

const BACKEND_URL = 'http://localhost:5000';// Replace with your backend URL

function AppContent() {
  const { setSessionId } = useSession();
  const [isChatVisible, setIsChatVisible] = useState(false);

  const handleStartSession = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/new_session`, {
        headers: {
          "ngrok-skip-browser-warning": "true",
        },
      });
      const data = await response.json();
      if (data.session_id) {
        setSessionId(data.session_id); // Use the correct key `session_id`
        setIsChatVisible(true); // Show the chat
      } else {
        console.error("Session ID not received");
      }
    } catch (error) {
      console.error("Failed to fetch session ID:", error);
    }
  };

  return (
    <div className="App">
      {!isChatVisible ? (
        <div>
          <h1>Welcome to the App</h1>
          <button onClick={handleStartSession}>Start Chat</button>
        </div>
      ) : (
        <CustomChat />
      )}
    </div>
  );
}

function App() {
  return (
    <SessionProvider>
      <AppContent />
    </SessionProvider>
  );
}

export default App;
