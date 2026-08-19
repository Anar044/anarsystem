function createChat() {
  const style = document.createElement('style');
  style.textContent = '.chat-toggle{position:fixed;right:24px;bottom:24px;z-index:30;width:60px;height:60px;border:0;border-radius:50%;background:#3ee3b5;color:#071520;font-size:26px;cursor:pointer;box-shadow:0 8px 25px #0008}.chat-box{position:fixed;right:24px;bottom:96px;z-index:30;width:min(350px,calc(100vw - 32px));padding:18px;border:1px solid #3ee3b5;border-radius:16px;background:#141b33;box-shadow:0 16px 45px #0008}.chat-box[hidden]{display:none}.chat-head{font-weight:bold;font-size:18px}.chat-text{color:#aeb9d6;font-size:14px}.chat-form{display:flex;gap:8px;margin-top:13px}.chat-form input{flex:1;padding:11px;border:1px solid #2b3760;border-radius:8px;background:#0e152b;color:#fff}.chat-form button{border:0;border-radius:8px;background:#6f8cff;color:#fff;padding:0 13px;cursor:pointer}.chat-answer{color:#3ee3b5;font-size:14px;margin:10px 0 0}@media(max-width:500px){.chat-toggle{right:16px;bottom:16px}.chat-box{right:16px;bottom:88px}}';
  document.head.appendChild(style);
  const widget = document.createElement('div');
  widget.innerHTML = '<button class="chat-toggle" aria-label="Открыть чат">💬</button><div class="chat-box" hidden><div class="chat-head">Чат Anar System</div><p class="chat-text">Здравствуйте! Напишите вопрос — мы поможем выбрать тариф.</p><form class="chat-form"><input required placeholder="Ваше сообщение"><button type="submit">➤</button></form><p class="chat-answer"></p></div>';
  document.body.appendChild(widget);
  const toggle = widget.querySelector('.chat-toggle'), box = widget.querySelector('.chat-box');
  toggle.addEventListener('click', () => { box.hidden = !box.hidden; });
  widget.querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    widget.querySelector('.chat-answer').textContent = 'Спасибо! Мы получили ваше сообщение и скоро ответим.';
    event.target.reset();
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createChat); else createChat();
