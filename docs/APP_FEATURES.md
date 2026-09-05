Waheguru Ji Ka Khalsa
Waheguru Ji Ki Fateh!

Original product vision (pre-V1). For what shipped, follow `docs/ROADMAP.md` and `docs/manual-test-plan.md`. Home lists sehaj paath by scripture, then reciter-named collections — not a Gursikh portrait grid.

App name:
Gurbani Audio Player

Main features:
- Android and iOS support  
- Multilingual UI (starting with English and Punjabi) with Easy Navigation and controls  
  - Important so that even elders can play easily  
  - People driving should be able to play easily as well, through notification or Android Auto (Carplay)  
- Homepage: Nice looking with Maharaj’s saroop with a list of multiple Gursikhs (One album for each)  
  - catalogue updatable from a server static json file, version number stored at a backend 
    - checks catalogue version number at cold start or refresh option from overflow menu in home screen appbar or swipe to refresh   
- Background playback  
- Download album/track for Offline playback  
- Pause and Resume from previous location in an album  
  - important controls on the now playing screen include prev, next, jump-backward-10-seconds, jump-forward-10-seconds, and a play/pause button in the center.  
    - row below with buttons for a sleep timer, an add bookmark, and a see bookmarks button  
  - for read along, a control to jump to the starting ang using a sttm.co link (e.g. for ang 83, https://sttm.co/g/83)  
- Bookmarks (with notes)  
- Library Page (any album can be added to library or removed)  
- Dark/Light Theme  
- Share Paath Album and Individual Tracks with deeplink  
- Sleep Timer  
  - at end of track/s (upto end of album)  
  - at end of selected duration ( no upper limit, to be input manually (like Google clock app but without seconds (only hours and minutes)))  
- Playback ends at the end of the album and not continued to another album  
- External Resorces page with other Sikhi apps  
  - Gurbani  
    - sttm.co, sttm mobile app  
  - Media  
    - gurbanisewa.org  
  - Special thanks to www.gurbanisewa.org for providing audio files

Extra features 

(should be possible with the chosen tech stack, not neccessarily implemented in the first phase, code should be modular enough to support these in the future)

- Support filter/categorization of paath audio albums according to translated languages (english, hindi, spanish etc.)   
- Support different scriptures filter for sehaj paath (like Sri Dasam Granth Sahib)  
- Play Pause through Gemini (or Siri)  
- Small Floating widget (android only) (shows up when playing and navigated to home)  
  - on tapped, should show controls for play/pause, jump 10 sec forward/backward  
    - primarily to aid reading along in another app  
- Audibooks section with similar features   
- Radios section  
- A web compatible version  
  - without downloads
- Add to home screen (album(resumes), track(resumes or streams))
- Option to share mp3 file directly for downloaded tracks
- build app in cloud with Github actions
- expo-updates for OTA updates