import { Icon } from "@/components/Icon";
import { MausAvatar } from "@/components/Avatar";
import type { MausColor } from "@/lib/mascot";

const BOTS: Array<{ name: string; color: MausColor; preview: string }> = [
  { name: "Nova", color: "blue", preview: "Found 3 direct flights to Lisbon" },
  { name: "Quill", color: "purple", preview: "The launch post draft is ready" },
  { name: "Juno", color: "pink", preview: "Booked the 18:10 home on Sunday" },
  { name: "Rivet", color: "orange", preview: "The footer fix is deployed" },
  { name: "Tally", color: "green", preview: "October is 4% under budget" },
  { name: "Echo", color: "teal", preview: "Summarised 12 new emails" },
];

/** the app behind the sheet: its sidebar of bots and a chat, drawn still */
export function AppReplica({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="replica" aria-hidden="false">
      <aside className="replica-side">
        <div className="replica-traffic" aria-hidden="true"><span /><span /><span /></div>
        <button type="button" className="replica-row replica-new"><Icon name="pencil-square" size={15} />New chat</button>
        <button type="button" className="replica-row"><Icon name="search" size={15} />Search</button>
        <p className="replica-label">Bots</p>
        {BOTS.map((bot, index) => (
          <button key={bot.name} type="button" className="replica-bot" aria-current={index === 0 ? "page" : undefined}>
            <MausAvatar color={bot.color} size={22} animated={false} />
            <span className="replica-bot-text">
              <span>{bot.name}</span>
              <span className="replica-quiet">{bot.preview}</span>
            </span>
          </button>
        ))}
        <button type="button" className="replica-row replica-settings" onClick={onOpenSettings}>
          <Icon name="settings-gear" size={15} />Settings
        </button>
      </aside>
      <section className="replica-chat">
        <header className="replica-chat-head">
          <MausAvatar color="blue" size={22} animated={false} />
          <span>Nova</span>
        </header>
        <div className="replica-thread">
          <div className="replica-msg replica-msg-user">Can you find me a flight to Lisbon next Friday?</div>
          <div className="replica-msg">I found 3 direct flights. The 09:40 is the cheapest at €118 and lands at 12:15. Want me to hold a seat?</div>
          <div className="replica-msg replica-msg-user">Yes, the 09:40 please. Window seat.</div>
          <div className="replica-msg">Done. Seat 14A is held until 18:00 today.</div>
        </div>
        <div className="replica-composer">Message Nova</div>
      </section>
    </div>
  );
}
