import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Mic, X, Volume2 } from 'lucide-react';
import { AISchedulerService } from '../services/AISchedulerService';
import { notificationService } from '../services/NotificationService';
import { getBrowserTimeZone } from '../utils/timezone';
import { Meeting } from '../types';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ConversationalAIProps {
  onMeetingCreated: (meeting: Meeting) => void;
  onClose: () => void;
}

export const ConversationalAI: React.FC<ConversationalAIProps> = ({ onMeetingCreated, onClose }) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: "Hi! I'm your AI meeting scheduler. I'll help you schedule a meeting by asking a few questions. Let's start - what would you like to schedule?",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
    
    // Initialize speech recognition
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';
      
      recognition.onresult = (event: SpeechRecognitionEvent) => {
        const transcript = event.results[0][0].transcript;
        setInput(transcript);
        setIsListening(false);
        // Auto-send after voice input
        setTimeout(() => {
          if (transcript.trim()) {
            handleSendWithMessage(transcript);
          }
        }, 500);
      };
      
      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
        notificationService.error('Voice Error', 'Failed to recognize speech. Please try typing instead.');
      };
      
      recognition.onend = () => {
        setIsListening(false);
      };
      
      recognitionRef.current = recognition;
    }
    
    // Initialize speech synthesis
    synthRef.current = window.speechSynthesis;
    
    // Speak the initial message after a short delay
    setTimeout(() => {
      speakMessage(messages[0].content);
    }, 500);
    
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if (synthRef.current) {
        synthRef.current.cancel();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  const speakMessage = (text: string) => {
    if (!synthRef.current) return;
    
    // Cancel any ongoing speech
    synthRef.current.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    
    synthRef.current.speak(utterance);
  };
  
  const startListening = () => {
    if (!recognitionRef.current) {
      notificationService.warning('Voice Not Supported', 'Your browser does not support speech recognition. Please type your message.');
      return;
    }
    
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      setIsListening(true);
      recognitionRef.current.start();
    }
  };
  
  const handleSendWithMessage = async (messageText?: string) => {
    const textToSend = messageText || input.trim();
    if (!textToSend || isLoading) return;

    setInput('');
    
    // Add user message to chat
    const newUserMessage: Message = {
      role: 'user',
      content: textToSend,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, newUserMessage]);
    setIsLoading(true);

    try {
      const timezone = getBrowserTimeZone();
      const response = await fetch(`${process.env.REACT_APP_API_URL || 'http://localhost:8000'}/api/ai/conversation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
        },
        body: JSON.stringify({
          message: textToSend,
          conversation_id: conversationId,
          timezone,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get AI response');
      }

      const data = await response.json();
      
      // Update conversation ID
      if (data.conversation_id && !conversationId) {
        setConversationId(data.conversation_id);
      }

      // Add assistant response
      const assistantMessage: Message = {
        role: 'assistant',
        content: data.response_message,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMessage]);
      
      // Speak the assistant's response
      speakMessage(data.response_message);

      // If meeting was created, handle it
      if (data.is_complete && data.meeting) {
        // Transform the meeting data
        const apiMeeting = data.meeting;
        const meeting: Meeting = {
          id: apiMeeting.id || apiMeeting._id,
          title: apiMeeting.title,
          description: apiMeeting.description,
          participants: apiMeeting.participants?.map((p: any) => ({
            id: p.id,
            name: p.name,
            email: p.email,
            availability: p.availability?.map((a: any) => ({
              start: new Date(a.start),
              end: new Date(a.end),
              isAvailable: a.is_available,
            })) || [],
          })) || [],
          startTime: new Date(apiMeeting.start_time),
          endTime: new Date(apiMeeting.end_time),
          duration: Math.round((new Date(apiMeeting.end_time).getTime() - new Date(apiMeeting.start_time).getTime()) / (1000 * 60)),
          status: apiMeeting.status,
          organizerEmail: apiMeeting.organizer_email,
          createdAt: new Date(apiMeeting.created_at),
          updatedAt: new Date(apiMeeting.updated_at),
          metadata: apiMeeting.metadata || {},
        };
        notificationService.success('Meeting Created', `Meeting "${meeting.title}" has been scheduled successfully!`);
        onMeetingCreated(meeting);
        setTimeout(() => {
          onClose();
        }, 2000);
      }
    } catch (error) {
      console.error('Error in conversational AI:', error);
      const errorMessage: Message = {
        role: 'assistant',
        content: "I'm sorry, I encountered an error. Could you please try again?",
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
      notificationService.error('Error', 'Failed to process your message. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async () => {
    await handleSendWithMessage();
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <Mic className="h-5 w-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-gray-900">AI Meeting Scheduler</h3>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                message.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-900 border border-gray-200'
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
              <p className={`text-xs mt-1 ${message.role === 'user' ? 'text-blue-100' : 'text-gray-500'}`}>
                {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white rounded-lg px-4 py-2 border border-gray-200">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-200 bg-white">
        <div className="flex gap-2">
          <button
            onClick={startListening}
            disabled={isLoading}
            className={`px-4 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 ${
              isListening
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
            title={isListening ? 'Stop listening' : 'Start voice input'}
          >
            <Mic className={`h-4 w-4 ${isListening ? 'animate-pulse' : ''}`} />
          </button>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={isListening ? "Listening..." : "Type your message or click mic to speak..."}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={isLoading || isListening}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading || isListening}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-gray-500">
            {isListening ? '🎤 Listening... Speak now' : isSpeaking ? '🔊 Speaking...' : 'Click mic to speak or type your message'}
          </p>
          {isSpeaking && (
            <Volume2 className="h-4 w-4 text-blue-600 animate-pulse" />
          )}
        </div>
      </div>
    </div>
  );
};

