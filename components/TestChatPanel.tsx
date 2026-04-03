'use client';

import React, { useState, useRef, useEffect } from 'react';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface AnalysisResult {
  mode: string;
  context: string;
  reasoning: string;
}

interface MemoryItem {
  name: string;
  description: string;
  content: string;
}

interface TestChatPanelProps {
  defaultOpen?: boolean;
  onTestComplete?: (results: any) => void;
}

export default function TestChatPanel({ defaultOpen = true, onTestComplete }: TestChatPanelProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentAnalysis, setCurrentAnalysis] = useState<AnalysisResult | null>(null);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (isOpen) {
      fetchMemories();
    }
  }, [isOpen]);

  const fetchMemories = async () => {
    try {
      const res = await fetch('/api/luna_talk/memories');
      if (res.ok) {
        const data = await res.json();
        setMemories(data.memories || []);
      }
    } catch (error) {
      console.error('Failed to fetch memories:', error);
    }
  };

  const sendMessage = async () => {
    if (!inputText.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: inputText,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setInputText('');

    try {
      const historyForApi = messages.map(m => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch('/api/luna_talk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...historyForApi, { role: 'user' as const, content: userMessage.content }],
        }),
      });

      if (!res.ok) {
        throw new Error(`API request failed: ${res.status}`);
      }

      const data = await res.json();
      const aiContent = data.reply || '抱歉，我走神了，请再说一次～';

      if (data.analysis) {
        console.log('📊 Luna 分析结果:', data.analysis);
        setCurrentAnalysis(data.analysis);
      }

      if (data.finalPrompt) {
        console.log('📝 回复 LLM 最终 Prompt:', data.finalPrompt);
      }

      const aiMessage: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: aiContent,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, aiMessage]);

      if (onTestComplete) {
        onTestComplete({ userMessage, aiMessage });
      }

    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `❌ 出错了: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setCurrentAnalysis(null);
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 right-4 z-50 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg shadow-lg transition-all duration-300 flex items-center gap-2"
      >
        <span>🌙</span>
        <span>Luna Talk</span>
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          onClick={() => setIsOpen(false)}
        />
      )}

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="relative bg-white shadow-2xl rounded-2xl shadow-lg transition-all duration-300 flex"
            style={{ width: '1200px', height: '75vh', maxHeight: '90vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setIsOpen(false)}
              className="absolute top-3 right-3 z-10 w-7 h-7 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center text-gray-600 text-sm"
            >
              ✕
            </button>

            {/* 左侧边栏 - 分析信息 */}
            <div className="w-64 bg-gradient-to-b from-purple-50 to-gray-50 border-r border-gray-200 flex flex-col overflow-hidden">
              <div className="p-4 border-b border-gray-200 bg-purple-600 h-[68px] flex items-center">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  📊 分析信息
                </h3>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div>
                  <h4 className="text-xs font-semibold text-purple-700 mb-2 flex items-center gap-1">
                    🎭 当前模式
                  </h4>
                  <div className="bg-white rounded-lg p-3 border border-gray-200 shadow-sm">
                    {currentAnalysis ? (
                      <span className="text-sm font-medium text-gray-800">
                        {currentAnalysis.mode}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">发送消息后显示</span>
                    )}
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-purple-700 mb-2 flex items-center gap-1">
                    👤 人设
                  </h4>
                  <div className="bg-white rounded-lg p-3 border border-gray-200 shadow-sm">
                    <span className="text-sm text-gray-700">Luna - 12岁英语学习伙伴</span>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-purple-700 mb-2 flex items-center gap-1">
                    📋 调用的内容
                  </h4>
                  <div className="bg-white rounded-lg p-3 border border-gray-200 shadow-sm">
                    {currentAnalysis && currentAnalysis.context ? (
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
                        <span className="text-xs text-gray-800">
                          {currentAnalysis.context}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">无</span>
                    )}
                  </div>
                </div>

                {currentAnalysis && (
                  <div>
                    <h4 className="text-xs font-semibold text-purple-700 mb-2 flex items-center gap-1">
                      💭 分析理由
                    </h4>
                    <div className="bg-white rounded-lg p-3 border border-gray-200 shadow-sm">
                      <p className="text-xs text-gray-600">{currentAnalysis.reasoning}</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4 border-t border-gray-200 bg-gray-50">
                <button
                  onClick={clearChat}
                  className="w-full px-3 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1"
                >
                  🗑️ 清空对话
                </button>
              </div>
            </div>

            {/* 中间 - 聊天区域 */}
            <div className="flex-1 flex flex-col bg-white">
              <div className="bg-gradient-to-r from-purple-600 to-purple-700 text-white p-4 h-[68px] flex items-center border-b border-gray-200">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  🌙 Luna Talk
                  <span className="text-xs opacity-75">v3.0</span>
                </h3>
              </div>

              <div className="flex-1 overflow-y-auto p-4 bg-gradient-to-b from-gray-50 to-gray-100">
                {messages.length === 0 ? (
                  <div className="text-center text-gray-400 p-8 mt-20">
                    <div className="text-5xl mb-4">🌙</div>
                    <p className="text-sm">你好，我是 Luna！</p>
                    <p className="text-xs mt-1">发消息开始聊天吧～</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages.map((message) => {
                      const isUser = message.role === 'user';
                      return (
                        <div
                          key={message.id}
                          className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-[70%] rounded-2xl px-4 py-3 shadow-sm ${
                              isUser
                                ? 'bg-purple-500 text-white rounded-tr-none'
                                : 'bg-white text-gray-800 rounded-tl-none border border-gray-200'
                            }`}
                          >
                            <div className="whitespace-pre-wrap text-sm">
                              {message.content}
                            </div>
                            <div
                              className={`text-xs mt-1 ${isUser ? 'text-purple-100' : 'text-gray-400'} text-right`}
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

              <div className="p-4 border-t border-gray-200 bg-white">
                <div className="flex gap-3 items-end">
                  <textarea
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={handleKeyPress}
                    placeholder="输入消息..."
                    className="flex-1 px-4 py-3 border border-gray-300 rounded-2xl focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm resize-none"
                    rows={1}
                    style={{ minHeight: '48px', maxHeight: '120px' }}
                  />
                  <button
                    onClick={sendMessage}
                    disabled={!inputText.trim() || isLoading}
                    className="px-5 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-full transition-colors flex items-center justify-center"
                  >
                    {isLoading ? '⏳' : '➤'}
                  </button>
                </div>
                <div className="text-xs text-gray-400 mt-2 text-center">
                  💡 按 Enter 发送消息
                </div>
              </div>
            </div>

            {/* 右侧边栏 - 用户记忆 */}
            <div className="w-56 bg-gradient-to-b from-purple-50 to-gray-50 border-l border-gray-200 flex flex-col overflow-hidden">
              <div className="p-4 border-b border-gray-200 bg-purple-600 h-[68px] flex items-center">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  🧠 用户记忆
                </h3>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {memories.length > 0 ? (
                  <div className="space-y-3">
                    {memories.map((memory, i) => (
                      <div key={i} className="bg-white rounded-lg p-3 border border-gray-200 shadow-sm">
                        <h5 className="text-xs font-semibold text-purple-700 mb-1">{memory.name}</h5>
                        {memory.description && (
                          <p className="text-xs text-gray-500 mb-2">{memory.description}</p>
                        )}
                        {memory.content && (
                          <div className="text-xs text-gray-600 whitespace-pre-wrap">
                            {memory.content.length > 100 ? `${memory.content.slice(0, 100)}...` : memory.content}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-gray-400 text-xs mt-8">
                    <div className="text-2xl mb-2">📝</div>
                    <p>暂无记忆</p>
                  </div>
                )}
              </div>

              <div className="p-4 border-t border-gray-200 bg-gray-50">
                <button
                  onClick={fetchMemories}
                  className="w-full px-3 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1"
                >
                  🔄 刷新记忆
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
