"use client";

import { useState, useEffect, useRef } from "react";
import { Mic, MicOff, Volume2, VolumeX, Send } from "lucide-react";
import { useSession } from "@/SessionContext";

const BACKEND_URL = 'http://localhost:5000';
const ASR_WEBSOCKET_URL = 'ws://localhost:8765';
const TTS_WEBSOCKET_URL = 'ws://localhost:8766';

export function LocalChat() {
    const { sessionId, setSessionId } = useSession();
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [instructionId, setInstructionId] = useState("1");
    const [customInstruction, setCustomInstruction] = useState("");
    const [instructions, setInstructions] = useState({});
    const [ttsConnected, setTtsConnected] = useState(false);

    const messagesEndRef = useRef(null);
    const asrSocketRef = useRef(null);
    const ttsSocketRef = useRef(null);
    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);
    const reconnectAttemptsRef = useRef(0);
    const maxReconnectAttempts = 5;

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    // Auto-scroll when messages change
    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // Initialize WebSocket connections
    useEffect(() => {
        const setupASRWebSocket = () => {
            asrSocketRef.current = new WebSocket(ASR_WEBSOCKET_URL);
            asrSocketRef.current.onmessage = handleASRMessage;
            asrSocketRef.current.onerror = (error) => console.error('ASR WebSocket error:', error);
            asrSocketRef.current.onclose = () => {
                console.log('ASR WebSocket closed. Reconnecting...');
                setTimeout(setupASRWebSocket, 5000);
            };
        };   

        setupASRWebSocket();

        return () => {
            asrSocketRef.current?.close();
        };
    }, [instructionId, customInstruction, ttsConnected]);

    useEffect(() => {
        const setupTTSWebSocket = () => {
            if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
                console.error('Max reconnection attempts reached for TTS WebSocket');
                return;
            }

            try {
                if (!ttsSocketRef.current || ttsSocketRef.current.readyState === WebSocket.CLOSED) {
                    console.log('Establishing TTS WebSocket connection...');
                    ttsSocketRef.current = new WebSocket(TTS_WEBSOCKET_URL);

                    ttsSocketRef.current.onopen = () => {
                        console.log('TTS WebSocket connected');
                        setTtsConnected(true);
                        reconnectAttemptsRef.current = 0;
                    };

                    ttsSocketRef.current.onmessage = handleTTSMessage;

                    ttsSocketRef.current.onclose = (event) => {
                        console.log(`TTS WebSocket closed with code: ${event.code}. Retrying...`);
                        setTtsConnected(false);
                        reconnectAttemptsRef.current += 1;
                        setTimeout(setupTTSWebSocket, 5000);
                    };

                    ttsSocketRef.current.onerror = (error) => {
                        console.error('TTS WebSocket error:', error);
                        setTtsConnected(false);
                        reconnectAttemptsRef.current += 1;
                        setTimeout(setupTTSWebSocket, 5000);
                    };
                } else {
                    console.log('TTS WebSocket is already open');
                }
            } catch (error) {
                console.error('Error setting up TTS WebSocket:', error);
                reconnectAttemptsRef.current += 1;
                setTimeout(setupTTSWebSocket, 5000);
            }
        };

        setupTTSWebSocket();

        return () => {
            ttsSocketRef.current?.close();
        };
    }, []);

    useEffect(() => {
        fetch(`${BACKEND_URL}/instruction_sets`, {
            headers: {
                "ngrok-skip-browser-warning": "true",
            },
        })
            .then((response) => response.json())
            .then((data) => {
                setInstructions(data);
                if (Object.keys(data).length > 0) {
                    setInstructionId(Object.keys(data)[0]);
                }
            })
            .catch((err) => console.error("Failed to fetch instruction sets:", err));
    }, []);

    const handleASRMessage = (event) => {
        try {
            const response = JSON.parse(event.data);
            console.log('ASR WebSocket message received:', response);

            if (response.status === "success" && response.text) {
                console.log('ASR recognized text:', response.text);
                setInput(response.text);
                const selectedInstructionId = customInstruction || instructionId;
                const ttsStatus = ttsConnected;
                sendMessage(response.text, selectedInstructionId, ttsStatus);
            }
        } catch (error) {
            console.error("Error processing ASR WebSocket message:", error);
        }
    };

    const handleTTSMessage = (event) => {
        console.log('Received TTS message:', event.data);
        try {
            const response = JSON.parse(event.data);
            if (response.error) {
                console.error('TTS error:', response.error);
                return;
            }
            if (response.audio) {
                console.log('Received audio data, attempting playback');
                playAudio(response.audio);
            } else {
                console.log('No audio data in response:', response);
            }
        } catch (error) {
            console.error("Error processing TTS message:", error);
        }
    };

    const playAudio = (base64Audio) => {
        try {
            // Create audio context
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Convert base64 to array buffer
            const binaryString = window.atob(base64Audio);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            // Decode audio data
            audioContext.decodeAudioData(bytes.buffer)
                .then(buffer => {
                    const source = audioContext.createBufferSource();
                    source.buffer = buffer;
                    source.connect(audioContext.destination);
                    source.onended = () => setIsSpeaking(false);
                    setIsSpeaking(true);
                    source.start(0);
                })
                .catch(error => {
                    console.error("Error decoding audio data:", error);
                    setIsSpeaking(false);
                });
        } catch (error) {
            console.error("Error playing audio:", error);
            setIsSpeaking(false);
        }
    };

    const sendTTSRequest = (text) => {
        if (!ttsSocketRef.current || ttsSocketRef.current.readyState !== WebSocket.OPEN) {
            console.error('TTS WebSocket is not connected or ready');
            return;
        }

        try {
            console.log('Sending TTS request for text:', text);
            const message = JSON.stringify({
                text: text,
                speaker_idx: 7308
            });
            ttsSocketRef.current.send(message);
            console.log('TTS request sent successfully');
        } catch (error) {
            console.error('Error sending TTS request:', error);
        }
    };

    const toggleListening = async () => {
        if (isListening) {
            stopRecording();
        } else {
            startRecording();
        }
    };

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorderRef.current = new MediaRecorder(stream);
            audioChunksRef.current = [];

            mediaRecorderRef.current.ondataavailable = (event) => {
                audioChunksRef.current.push(event.data);
            };

            mediaRecorderRef.current.onstop = async () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.onload = () => {
                    const base64Audio = reader.result.split(',')[1];
                    asrSocketRef.current?.send(JSON.stringify({
                        type: "audio",
                        audio: base64Audio,
                        format: "webm"
                    }));
                };
                reader.readAsDataURL(audioBlob);
            };

            mediaRecorderRef.current.start();
            setIsListening(true);
        } catch (error) {
            console.error("Error starting recording:", error);
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
            mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
            setIsListening(false);
        }
    };

    const sendMessage = async (messageContent) => {
        if (!messageContent.trim()) return;

        const userMessage = { role: "user", content: messageContent };
        setMessages((prev) => [...prev, userMessage]);
        setInput("");

        try {
            setIsLoading(true);
            const selectedInstructionId = customInstruction || instructionId;

            const response = await fetch(`${BACKEND_URL}/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
                body: JSON.stringify({
                    session_id: sessionId,
                    instruction_id: selectedInstructionId,
                    question: userMessage.content,
                }),
            });

            const data = await response.json();
            if (response.ok) {
                const botResponse = { role: "assistant", content: data.response };
                setMessages((prev) => [...prev, botResponse]);

                if (ttsSocketRef.current && ttsSocketRef.current.readyState === WebSocket.OPEN) {
                    console.log('Triggering TTS with:', data.response);
                    sendTTSRequest(data.response);
                } else {
                    console.log('TTS not connected or ready. Skipping speech synthesis.');
                }
            }
        } catch (err) {
            console.error("Failed to send message:", err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!input.trim()) return;
        sendMessage(input.trim());
    };

    return (
        <div className="min-h-screen bg-gray-100 p-4">
            <h1 className="text-3xl font-bold text-center mb-8">
                Welcome to the Bot
            </h1>
            <div className="max-w-2xl mx-auto p-4 bg-white rounded-lg shadow">
                <div className="mb-4">
                    <label htmlFor="instruction-select" className="block mb-2 font-semibold">
                        Select or Enter Instruction Set:
                    </label>
                    <div className="flex items-center gap-2">
                        <select
                            id="instruction-select"
                            value={instructionId}
                            onChange={(e) => {
                                setInstructionId(e.target.value);
                                setCustomInstruction("");
                            }}
                            className="p-2 border rounded flex-1"
                        >
                            {Object.entries(instructions).map(([id, name]) => (
                                <option key={id} value={id}>
                                    {name}
                                </option>
                            ))}
                        </select>
                        <input
                            type="number"
                            value={customInstruction}
                            onChange={(e) => setCustomInstruction(e.target.value)}
                            placeholder="Enter ID"
                            className="p-2 border rounded w-28"
                        />
                    </div>
                </div>
                <div className="h-[400px] overflow-y-auto mb-4 p-4 border rounded bg-gray-50">
                    {messages.map((message, index) => (
                        <div
                            key={index}
                            className={`mb-4 ${message.role === "user" ? "text-right" : "text-left"}`}
                        >
                            <div
                                className={`inline-block p-2 rounded-lg ${
                                    message.role === "user"
                                        ? "bg-blue-500 text-white"
                                        : "bg-gray-200 text-black"
                                }`}
                            >
                                {message.content}
                            </div>
                        </div>
                    ))}
                    {isLoading && (
                        <div className="text-left">
                            <div className="inline-block p-2 rounded-lg bg-gray-200">
                                Typing...
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} /> {/* Add this invisible element for scrolling */}
                </div>
                <div className="flex items-center gap-2 mb-4">
                    <button
                        onClick={toggleListening}
                        className={`p-2 rounded-lg border ${isListening ? "bg-red-100" : "hover:bg-gray-100"}`}
                    >
                        {isListening ? (
                            <MicOff className="h-4 w-4" />
                        ) : (
                            <Mic className="h-4 w-4" />
                        )}
                    </button>
                    <button
                        onClick={() => setIsSpeaking(!isSpeaking)}
                        disabled={!messages.length}
                        className="p-2 rounded-lg border hover:bg-gray-100 disabled:opacity-50"
                    >
                        {isSpeaking ? (
                            <VolumeX className="h-4 w-4" />
                        ) : (
                            <Volume2 className="h-4 w-4" />
                        )}
                    </button>
                   
                </div>
                <form onSubmit={handleSubmit} className="flex gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Type your message..."
                        className="flex-1 p-2 border rounded"
                    />
                    <button
                        type="submit"
                        disabled={isLoading || !input.trim()}
                        className="p-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
                    >
                        <Send className="h-4 w-4" />
                    </button>
                </form>
            </div>
         </div>
    );
}

export default LocalChat;