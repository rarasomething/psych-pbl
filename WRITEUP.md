# Cognitive Distortions: Snake

A browser-based Snake game that uses gameplay mechanics to illustrate Beck's
cognitive model of depression — specifically, how accumulating distorted
thinking patterns can compound and how coping strategies can counteract them.

## Concept

Instead of ordinary food, the snake eats two kinds of pellets:

- **Distortion pellets** (all shades of red) represent six common cognitive
  distortions — Jumping to Conclusions, All-or-Nothing Thinking, Blowing
  Things Out of Proportion, Overgeneralizing, Taking It Personally, and
  Tunnel Vision. Eating one grows the snake and speeds up the game — a
  stand-in for how internalizing a distortion adds weight and makes things
  harder to manage.
- **Coping pellets** (bright teal/green/blue diamonds) represent CBT coping
  strategies — Checking the Evidence, Reframing the Thought, and Taking a
  Small Step. Eating one counteracts the distortions, each in its own way
  (see below).

The longer the snake survives, the more distortions have piled up and the
faster/tighter the board gets — visualizing how unaddressed distorted
thinking compounds over time rather than staying static.

## Key features

- **Two independent pellet pools.** Distortions spawn frequently and
  ambiently (pressure builds even if the player doesn't eat), while coping
  pellets are rarer and spawn on a delay after being used — deliberately
  asymmetric, since coping skills take more effort than falling into a
  distortion.
- **Each coping skill has a distinct effect**, rather than all doing the same
  thing:
  - *Checking the Evidence* — shrinks the trail by 3.
  - *Reframing the Thought* — clears a few distortion pellets off the board
    outright.
  - *Taking a Small Step* — temporarily slows the game down for 5 seconds.
- **In-the-moment education.** Eating any pellet pops up a short, plain-
  language toast explaining what that distortion or coping skill actually is
  (e.g., "You assumed the worst with barely any evidence to back it up"),
  reinforcing the label with a one-line definition rather than jargon alone.
- **Visual design reinforces the theme.** The snake's trail darkens
  gradually from head to tail as it grows, and distortion pellets are all
  red-toned (clearly "negative") while coping pellets are bright and
  visually distinct — colors carry meaning, not just decoration.
- **Survival-time scoring**, not pellet count, so the score reflects how
  long the player managed the accumulating pressure rather than rewarding
  reckless eating.
- **Separate tallies** for distortions and coping skills used, shown live in
  the sidebar and summarized at game over.

## Audience & purpose

Built as a lightweight, engaging way to introduce Beck's cognitive model to
a general audience with no clinical background — using an interactive format
rather than a static explainer, on the idea that gameplay can make the
"distortions pile up, coping skills push back" mechanism more intuitive than
text alone.

*Note: this is a prototype focused on the mechanics and terminology. It does
not yet include an explicit statement of what Major Depressive Disorder is,
the full negative-triad framing behind the distortions, citations, or a
disclaimer/resources section — worth adding before using this for public-
facing awareness material.*
