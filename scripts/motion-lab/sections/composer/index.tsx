import type { Section } from "@lab/types";
import { ComposerA, ComposerB, ComposerOriginal } from "./composer-send";
import { VoiceA, VoiceB, VoiceOriginal } from "./voice";
import { AttachA, AttachB, AttachOriginal } from "./attachments";
import { PickerA, PickerB, PickerOriginal } from "./model-picker";
import { MenuA, MenuB, MenuOriginal } from "./menus";
import { TipA, TipB, TipOriginal } from "./tooltips";
import { PillsA, PillsB, PillsOriginal, ScopeA, ScopeB, ScopeOriginal } from "./pills";
import { ActionsA, ActionsB, ActionsOriginal } from "./copy-like";

const section: Section = {
  id: "composer",
  title: "Composer and pickers",
  order: 20,
  items: [
    {
      id: "composer-send",
      title: "Composer grow and send to stop",
      surface: "composer",
      height: 260,
      loopMs: 6400,
      notes: {
        original: "Composer.tsx + composer.css: height and radius 300ms on --composer-spring (1000/63 linear()) only when the field stacks, then it follows the text at once; field slides 300ms; Send to Stop pops the new glyph from scale .5 (200ms) over a fading ghost; mic to Send has no motion; press .96. Type, Enter, press Stop.",
        a: "Height on spring.height 300/22 for every line; field moves with layout spring (0.3s, no bounce); every round-button swap is one recipe: new glyph rises 8px from 3px blur (200ms ease.out), old leaves up 6px (120ms); fill fades 150ms; press .97.",
        b: "Height on spring.settle 280/22; one progress spring (pop 520/26) turns the arrow a quarter and shrinks it as the Stop square grows; sent words lift 26px into a 4px blur (320ms) as the field clears; a thin arc runs round Stop while the bot works (1.1s/turn, off with reduced motion). Recipe after designbookmark db-prompt-box, reimplemented.",
      },
      Original: ComposerOriginal, A: ComposerA, B: ComposerB,
    },
    {
      id: "voice",
      title: "Voice: dictation strip and mic",
      surface: "composer",
      height: 220,
      loopMs: 5200,
      notes: {
        original: "ComposerVoiceStrip (the real component, fed a fake mic): the strip fades in 120ms (@starting-style), the field comes back at once; the mic turns into the dark check with no motion; words appear raw.",
        a: "Strip rises 6px from 2px blur (200ms ease.out), field fades back in 150ms; mic and check swap with the 8px rise and blur; each heard word fades in 150ms; Discard and Send fade in at .9 scale.",
        b: "Strip wipes in from the right edge (clip-path, 320ms ease.out); words rise 6px from 3px blur on spring.fade; a ring behind the check follows the real input level (scale 1.0 to 1.15 on follow 900/50: honest, not a loop; idea from AI Elements SpeechInput, Apache-2.0, no code taken); check pops on spring.pop.",
      },
      Original: VoiceOriginal, A: VoiceA, B: VoiceB,
    },
    {
      id: "attachments",
      title: "Attachments strip",
      surface: "composer",
      height: 260,
      loopMs: 5200,
      notes: {
        original: "ComposerAttachments: tiles appear and leave instantly; on first show the strip rides the pill's top edge (translateY(grow) to 0, 300ms --composer-spring) while the pill grows; upload ring eases 300ms linear between reports and fades 180ms. Press + to add, hover a tile to remove.",
        a: "Tiles enter at .95 + fade (180ms ease.out), leave at .95 in 120ms; neighbours close the gap on the layout spring; pill height on spring.height.",
        b: "Tiles rise 8px at .92 from 4px blur on spring.pop, leave at .9 with 2px blur (120ms); neighbours slide on spring.settle; a green check pops when an image finishes uploading, then fades; the strip itself rises 10px on settle.",
      },
      Original: AttachOriginal, A: AttachA, B: AttachB,
    },
    {
      id: "model-picker",
      title: "Model picker and starring",
      surface: "composer",
      height: 470,
      loopMs: 6000,
      notes: {
        original: "ModelPicker + overlays.css: grows from the trigger, 4px and .97 to rest in 120ms (0.16,1,0.3,1), out 80ms at .98; starring is instant: the star fills and the row is just there in Starred, rows below jump.",
        a: "Origin-aware popover: .97 to 1 + fade, 160ms ease.out, out 120ms at .99; Starred opens by height on the layout spring and its rows fade in 60ms behind; star is a plain fill.",
        b: "Popover unrolls upward from the trigger (clip-path on spring.height 300/22) and rows rise 6px with a 45ms stagger on open only; the star pops on spring.pop; a newly starred row lifts out of its place in the list and settles into Starred on spring.settle while the list makes room.",
      },
      Original: PickerOriginal, A: PickerA, B: PickerB,
    },
    {
      id: "profile-menu",
      title: "Menus and submenus (profile menu, Support)",
      surface: "sidebar",
      height: 340,
      loopMs: 5200,
      notes: {
        original: "SidebarPopoverMenu, grok rows: menu in 120ms (4px, .97, from the trigger), out 80ms; Support's submenu opens after a 100ms dwell with no motion; row fill appears instantly; leaving closes after 300ms grace.",
        a: "Menu .97 + 4px rise, 150ms ease.out, out 100ms fade; submenu slides 4px from the parent side and fades (120ms), out 75ms; row fill stays instant.",
        b: "Menu unrolls upward (clip-path on spring.height), rows rise 6px with 45ms stagger from the bottom; one hover fill stretches row to row on two edges (lead 620/36, trail 190/19); submenu slides 6px at .97 out of 2px blur on spring.fade.",
      },
      Original: MenuOriginal, A: MenuA, B: MenuB,
    },
    {
      id: "tooltips",
      title: "Tooltips",
      surface: "toolbar",
      height: 200,
      loopMs: 5600,
      notes: {
        original: "TitleTooltips: 300ms delay, appears with no motion, moves between tools at once while one shows, hides 100ms after you leave with no fade.",
        a: "400ms delay, then 300ms warm window (later tips instant, no motion); first show fades in at .98 with 2px rise (150ms); hides after 140ms grace with a 100ms fade.",
        b: "One shared tooltip: first show grows out of the tool (6px, .92 on spring.fade, origin 50% 140%); later hovers make it travel and resize on lead/trail edges while the label slides 14px the way you moved through 3px blur. Timing as A. After designbookmark db-morph-tooltip, reimplemented.",
      },
      Original: TipOriginal, A: TipA, B: TipB,
    },
    {
      id: "pills",
      title: "Segmented and sliding pills",
      surface: "settings, model menu",
      height: 240,
      loopMs: 4400,
      notes: {
        original: "The real ui/Segmented (lifted card, 240ms ease-out on transform + width) and ui/SlidingPills (thumb steps one pill on --dusk-ease-spring, 200ms); two recipes for one idea; labels change ink in 120ms.",
        a: "One recipe for both: the thumb glides on the layout spring (no bounce, 0.3s), labels fade ink 150ms, press .98.",
        b: "Both stretch: the thumb's leading edge runs on lead 620/36 and its back edge catches up on trail 190/19, so a long jump visibly stretches then settles; press .96.",
      },
      Original: PillsOriginal, A: PillsA, B: PillsB,
    },
    {
      id: "scope",
      title: "Scope pills: This bot | All bots",
      surface: "model menu",
      height: 220,
      loopMs: 4400,
      notes: {
        original: "SimpleModelMenu Scope (real SlidingPills): thumb slides 200ms on the app spring; what each choice means lives only in the hover title.",
        a: "Calm thumb (layout spring); the meaning shows under the pills and swaps with an 8px rise through 2px blur (200ms in, 120ms out).",
        b: "Stretchy thumb; the meaning slides 14px the way the thumb went; for All bots the other bots' faces gather beside it (pop spring, 45ms stagger in, no exit stagger), so the reach of the choice is visible.",
      },
      Original: ScopeOriginal, A: ScopeA, B: ScopeB,
    },
    {
      id: "copy-react",
      title: "Copy and react buttons",
      surface: "chat",
      height: 260,
      loopMs: 5200,
      notes: {
        original: "MessageActions + Reactions: copy swaps to a green check with no motion, back after 1.2s; the reaction row pops in (scale .96, 6px, 200ms); the chip pops from .6 with a 7.8% overshoot (500ms, chat-reaction-pop).",
        a: "Copy and check cross-blur at .8 (150ms in, 120ms out), check holds 1.8s; reaction row .97 + 2px (150ms), out 100ms; chip enters at .9 + fade (180ms ease.out).",
        b: "Copy turns away (-40deg, .5) as the check springs in on spring.pop and \"Copied\" rolls out beside it on the width spring (db-copy-button study, reimplemented); the picked emoji bumps 1.18 before the row closes; chip rises 6px from .85 on spring.pop.",
      },
      Original: ActionsOriginal, A: ActionsA, B: ActionsB,
    },
  ],
};

export default section;
