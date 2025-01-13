"use client";

import { useState, useEffect, useRef } from "react";
import { Mic, MicOff, Volume2, VolumeX, Send } from "lucide-react";
import { useSession } from "@/SessionContext";

const BACKEND_URL = import.meta.env.VITE_PUBLIC_BACKEND_URL;
const SILENCE_THRESHOLD = -50;
const SILENCE_DURATION = 1500;

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
    const [errorMessage, setErrorMessage] = useState("");

    const messagesEndRef = useRef(null);
    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);
    const audioContextRef = useRef(null);
    const audioSourceRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

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

    const processAudioToText = async (audioBase64) => {
        try {
            setErrorMessage(""); // Clear any previous errors
            const response = await fetch(`${BACKEND_URL}/speech-to-text`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    "ngrok-skip-browser-warning": "true"
                },
                body: JSON.stringify({
                    audio: audioBase64,
                    format: 'webm'
                })
            });

            const data = await response.json();
            if (data.status === "success" && data.text) {
                console.log('Speech recognition result:', data.text);
                setInput(data.text);
                sendMessage(data.text);
            } else {
                console.error('Speech recognition failed:', data.message);
                setErrorMessage(data.message || "Speech recognition failed. Please try again.");
                stopRecording();
            }
        } catch (error) {
            console.error("Error in speech recognition:", error);
            setErrorMessage("Connection failed. Please check your internet connection and try again.");
            stopRecording();
        }
    };


    const synthesizeSpeech = async (text) => {
        try {
            console.log('Requesting speech synthesis for:', text);
            const response = await fetch(`${BACKEND_URL}/text-to-speech`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    "ngrok-skip-browser-warning": "true"
                },
                body: JSON.stringify({
                    text: text,
                    voice_idx: 0
                })
            });

            const data = await response.json();
            if (data.status === "success" && data.audio) {
                console.log('Received audio data, playing...');
                await playAudio(data.audio);
            } else {
                console.error('Speech synthesis failed:', data.message);
            }
        } catch (error) {
            console.error("Error in speech synthesis:", error);
        }
    };

    const playAudio = async (base64Audio) => {
        try {
            if (!audioContextRef.current) {
                audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
            }

            // Stop any currently playing audio
            if (audioSourceRef.current) {
                audioSourceRef.current.stop();
                audioSourceRef.current = null;
            }

            const binaryString = window.atob(base64Audio);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            setIsSpeaking(true);
            const audioBuffer = await audioContextRef.current.decodeAudioData(bytes.buffer);
            audioSourceRef.current = audioContextRef.current.createBufferSource();
            audioSourceRef.current.buffer = audioBuffer;
            audioSourceRef.current.connect(audioContextRef.current.destination);
            audioSourceRef.current.onended = () => {
                setIsSpeaking(false);
                audioSourceRef.current = null;
            };
            audioSourceRef.current.start(0);
        } catch (error) {
            console.error("Error playing audio:", error);
            setIsSpeaking(false);
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
            mediaRecorderRef.current = new MediaRecorder(stream)
;
            audioChunksRef.current = [];

            mediaRecorderRef.current.ondataavailable = (event) => {
                audioChunksRef.current.push(event.data);
            };

            mediaRecorderRef.current.onstop = async () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.onload = () => {
                    const base64Audio = reader.result.split(',')[1];
                    processAudioToText(base64Audio);
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

    const toggleSpeaking = () => {
        if (isSpeaking && audioSourceRef.current) {
            audioSourceRef.current.stop();
            audioSourceRef.current = null;
            setIsSpeaking(false);
        } else if (messages.length > 0) {
            const lastAssistantMessage = messages
                .filter(m => m.role === "assistant")
                .pop();
            if (lastAssistantMessage) {
                synthesizeSpeech(lastAssistantMessage.content);
            }
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
                headers: { 
                    "Content-Type": "application/json",
                    "ngrok-skip-browser-warning": "true"
                },
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
                synthesizeSpeech(data.response);
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
                    <div ref={messagesEndRef} />
                </div>
                {errorMessage && (
                    <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg">
                        {errorMessage}
                    </div>
                )}
                <div className="flex items-center gap-2 mb-4">
                    <button
                        onClick={toggleListening}
                        className={`p-2 rounded-lg border ${
                            isListening ? "bg-red-100" : "hover:bg-gray-100"
                        } ${errorMessage ? "border-red-500" : ""}`}
                    >
                        {isListening ? (
                            <MicOff className="h-4 w-4" />
                        ) : (
                            <Mic className="h-4 w-4" />
                        )}
                    </button>
                    <button
                        onClick={toggleSpeaking}
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