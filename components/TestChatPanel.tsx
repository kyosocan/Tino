'use client';

import React, { useState, useRef, useEffect } from 'react';

interface TestMessage {
  id: string;
  type: 'user' | 'ai' | 'system';
  content: string;
  timestamp: Date;
  mode?: string;
  response?: any;
}

interface TestChatPanelProps {
  defaultOpen?: boolean;
  onTestComplete?: (results: any) => void;
}

export default function TestChatPanel({ defaultOpen = true, onTestComplete }: TestChatPanelProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [messages, setMessages] = useState<TestMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentMode, setCurrentMode] = useState('ai_turn');
  const [difficulty, setDifficulty] = useState('easy');
  const [playerName, setPlayerName] = useState('Test User');
  const [turnIndex, setTurnIndex] = useState(0);
  const [theme, setTheme] = useState('Daily Talk');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const addSystemMessage = (content: string) => {
    setMessages(prev => [
      ...prev,
      {
        id: `system-${Date.now()}`,
        type: 'system',
        content,
        timestamp: new Date(),
      },
    ]);
  };

  const sendTestMessage = async () => {
    if (!inputText.trim() || isLoading) return;

    const userMessage: TestMessage = {
      id: `user-${Date.now()}`,
      type: 'user',
      content: inputText,
      timestamp: new Date(),
      mode: currentMode,
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setInputText('');

    try {
      const body: any = {
        mode: currentMode as any,
        theme,
        difficulty: difficulty as any,
        playerName,
        transcript: inputText,
        turnIndex,
        tasks: ['test', 'debug'],
        needSupport: difficulty === 'easy',
      };

      const res = await fetch('/api/luna_talk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error(`API request failed: ${res.status}`);
      }

      const response = await res.json();

      let aiContent = '';
      const data = response as any;
      if (currentMode === 'room_intro') {
        aiContent = data.intro || '';
      } else if (currentMode === 'host_turn') {
        aiContent = data.hostPrompt || '';
      } else if (currentMode === 'coach') {
        aiContent = data.aiReply || data.hostPrompt || '';
      } else if (currentMode === 'ai_turn') {
        aiContent = data.aiReply || '';
      }

      const aiMessage: TestMessage = {
        id: `ai-${Date.now()}`,
        type: 'ai',
        content: aiContent,
        timestamp: new Date(),
        mode: currentMode,
        response,
      };

      setMessages(prev => [...prev, aiMessage]);
      setTurnIndex(prev => prev + 1);

      if (onTestComplete) {
        onTestComplete({ mode: currentMode, request: body, response });
      }

    } catch (error) {
      console.error('Test error:', error);
      addSystemMessage(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendTestMessage();
    }
  };

  const resetTestSession = () => {
    setMessages([]);
    setTurnIndex(0);
    setInputText('');
    addSystemMessage('🔄 Test session reset');
  };

  const clearHistory = () => {
    setMessages([]);
    addSystemMessage('🗑️ Chat history cleared');
  };

  return (
    <>
      {/* Toggle Button - Top Right */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 right-4 z-50 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg shadow-lg transition-all duration-300 flex items-center gap-2"
      >
        <span>🧪</span>
        <span>测试</span>
      </button>

      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Chat Panel - Centered Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="relative bg-white shadow-2xl rounded-2xl shadow-lg transition-all duration-300 flex"
            style={{ width: '900px', height: '70vh', maxHeight: '90vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setIsOpen(false)}
              className="absolute top-3 right-3 z-10 w-7 h-7 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center text-gray-600 text-sm"
            >
              ✕
            </button>

            {/* Sidebar - Configuration */}
            <div className="w-64 bg-gray-50 border-r border-gray-200 flex flex-col p-4 overflow-y-auto">
              <h3 className="text-sm font-bold text-gray-700 mb-4">⚙️ 配置</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    对话模式
                  </label>
                  <select
                    value={currentMode}
                    onChange={(e) => setCurrentMode(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  >
                    <option value="ai_turn">AI 伙伴回复</option>
                    <option value="coach">教练指导</option>
                    <option value="host_turn">主持人提问</option>
                    <option value="room_intro">房间介绍</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    难度
                  </label>
                  <select
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  >
                    <option value="easy">简单</option>
                    <option value="medium">中等</option>
                    <option value="hard">困难</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    回合索引
                  </label>
                  <input
                    type="number"
                    value={turnIndex}
                    onChange={(e) => setTurnIndex(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    min="0"
                    max="20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    玩家姓名
                  </label>
                  <input
                    type="text"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    placeholder="Test User"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    对话主题
                  </label>
                  <input
                    type="text"
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    placeholder="Daily Talk"
                  />
                </div>
              </div>

              <div className="mt-auto pt-4 space-y-2">
                <button
                  onClick={resetTestSession}
                  className="w-full px-3 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-md text-xs font-medium transition-colors"
                >
                  🔄 重置会话
                </button>
                <button
                  onClick={clearHistory}
                  className="w-full px-3 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-md text-xs font-medium transition-colors"
                >
                  🗑️ 清空记录
                </button>
              </div>
            </div>

            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col bg-white">
              {/* Header */}
              <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-4">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  🧪 测试聊天面板
                  <span className="text-xs opacity-75">v2.0</span>
                </h3>
                <p className="text-xs mt-1 opacity-90">模式: {currentMode} | 难度: {difficulty}</p>
              </div>

              {/* Message List */}
              <div className="flex-1 overflow-y-auto p-4 bg-gradient-to-b from-gray-50 to-gray-100">
                {messages.length === 0 ? (
                  <div className="text-center text-gray-400 p-8 mt-20">
                    <div className="text-5xl mb-4">💬</div>
                    <p className="text-sm">发送消息开始测试</p>
                    <p className="text-xs mt-1">在左侧调整配置参数</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages.map((message) => {
                      if (message.type === 'system') {
                        return (
                          <div key={message.id} className="flex justify-center">
                            <span className="text-xs text-gray-500 bg-gray-200 px-3 py-1 rounded-full">
                              {message.content}
                            </span>
                          </div>
                        );
                      }

                      const isUser = message.type === 'user';
                      return (
                        <div
                          key={message.id}
                          className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-[70%] rounded-2xl px-4 py-3 shadow-sm ${
                              isUser
                                ? 'bg-blue-500 text-white rounded-tr-none'
                                : 'bg-white text-gray-800 rounded-tl-none border border-gray-200'
                            }`}
                          >
                            <div className="whitespace-pre-wrap text-sm">
                              {message.content}
                            </div>
                            <div
                              className={`text-xs mt-1 ${isUser ? 'text-blue-100' : 'text-gray-400'} text-right`}
                            >
                              {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {isLoading && (
                      <div className="flex justify-start">
                        <div className="bg-white text-gray-800 rounded-2xl rounded-tl-none border border-gray-200 px-4 py-3 shadow-sm">
                          <div className="flex gap-1.5 items-center">
                            {[0, 1, 2].map(i => (
                              <span
                                key={i}
                                className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
                                style={{ animationDelay: `${i * 150}ms` }}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input Area */}
              <div className="p-4 border-t border-gray-200 bg-white">
                <div className="flex gap-3 items-end">
                  <textarea
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={handleKeyPress}
                    placeholder="输入测试消息..."
                    className="flex-1 px-4 py-3 border border-gray-300 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
                    rows={1}
                    style={{ minHeight: '48px', maxHeight: '120px' }}
                  />
                  <button
                    onClick={sendTestMessage}
                    disabled={!inputText.trim() || isLoading}
                    className="px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-full transition-colors flex items-center justify-center"
                  >
                    {isLoading ? '⏳' : '➤'}
                  </button>
                </div>
                <div className="text-xs text-gray-400 mt-2 text-center">
                  💡 按 Enter 发送消息
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
