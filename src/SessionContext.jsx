import React, { createContext, useContext, useEffect, useState } from "react";

const SessionContext = createContext();

export const useSession = () => useContext(SessionContext);

export const SessionProvider = ({ children }) => {
  const [sessionId, setSessionId] = useState(null);

  useEffect(() => {
    console.log("Session ID in Context:", sessionId); // Debug log
  }, [sessionId]);

  return (
    <SessionContext.Provider value={{ sessionId, setSessionId }}>
      {children}
    </SessionContext.Provider>
  );
};

