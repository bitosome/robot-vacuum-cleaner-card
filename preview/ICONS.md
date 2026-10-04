# Preview icons

The local `ha-icon` fixture uses SVG paths from [Material Design Icons](https://github.com/Templarian/MaterialDesign), pinned at `2424e748e0cc63ab7b9c095a099b9fe239b737c0`. Their Apache-2.0 license is included in [LICENSE-MDI](LICENSE-MDI). This makes preview icons match the same `mdi:` names used by Home Assistant and Space Hub.

The card itself renders Home Assistant's native `ha-icon`; there is no runtime download or bundled icon registry. Room-specific icons are configuration or native area metadata, not guessed from room names.
