'use client';

import React, { useState, useRef, useEffect } from 'react';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [systemPrompt, setSystemPrompt] = useState(`你是 Luna，一个友好的 AI 聊天助手。

性格特点：
- 温暖友好，像一个好朋友
- 耐心倾听，积极回应
- 说话简洁自然
- 偶尔会用一些可爱的表情符号

聊天规则：
1. 保持对话流畅自然
2. 用简单易懂的语言
3. 多用疑问句保持对话活跃
4. 回复控制在 2-3 句话
5. 可以适当使用表情符号，但不要太多
6. 根据上下文保持话题的连贯性`);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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
      // 构建 history：只传递 user/assistant 消息，不包含当前这条（会在 API 处理）
      const historyForApi = messages.map(m => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch('/api/luna_talk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...historyForApi, { role: 'user' as const, content: userMessage.content }],
          systemPrompt: systemPrompt || undefined,
        }),
      });

      if (!res.ok) {
        throw new Error(`API request failed: ${res.status}`);
      }

      const data = await res.json();
      const aiContent = data.reply || '抱歉，我走神了，请再说一次～';

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
  };

  return (
    <>
      {/* Toggle Button - Top Right */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 right-4 z-50 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg shadow-lg transition-all duration-300 flex items-center gap-2"
      >
        <span>🌙</span>
        <span>Luna Talk</span>
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
            <div className="w-72 bg-gray-50 border-r border-gray-200 flex flex-col p-4 overflow-y-auto">
              <h3 className="text-sm font-bold text-gray-700 mb-4">⚙️ 配置</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    System Prompt
                  </label>
                  <textarea
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 text-xs resize-none"
                    rows={12}
                  />
                </div>
              </div>

              <div className="mt-auto pt-4">
                <button
                  onClick={clearChat}
                  className="w-full px-3 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-md text-xs font-medium transition-colors"
                >
                  🗑️ 清空对话
                </button>
              </div>
            </div>

            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col bg-white">
              {/* Header */}
              <div className="bg-gradient-to-r from-purple-600 to-purple-700 text-white p-4">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  🌙 Luna Talk
                  <span className="text-xs opacity-75">v2.0</span>
                </h3>
                <p className="text-xs mt-1 opacity-90">简单的多轮对话测试</p>
              </div>

              {/* Message List */}
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

              {/* Input Area */}
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
          </div>
        </div>
      )}
    </>
  );
}
