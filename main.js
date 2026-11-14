const { Plugin, PluginSettingTab, Setting, Modal } = require("obsidian");

const DEFAULTS = {
  enabled: true,
  unit: "px",       // "px" or "%"
  px: 1000,
  percent: 85,
  step: 50,         // px step for the wider/narrower commands (percent uses 5)
  showStatusBar: true,
};

const LIMITS = { px: [300, 3000], "%": [20, 100] };

class NoteWidthChanger extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("nwc-status");
    this.statusEl.setAttribute("aria-label", "Change text width");
    this.registerDomEvent(this.statusEl, "click", () => new WidthModal(this.app, this).open());

    this.addSettingTab(new NWCSettingTab(this.app, this));

    this.addCommand({ id: "wider", name: "Make text wider", callback: () => this.nudge(+1) });
    this.addCommand({ id: "narrower", name: "Make text narrower", callback: () => this.nudge(-1) });
    this.addCommand({ id: "adjust", name: "Adjust text width…", callback: () => new WidthModal(this.app, this).open() });
    this.addCommand({
      id: "toggle", name: "Turn custom width on/off",
      callback: async () => { this.settings.enabled = !this.settings.enabled; await this.save(); },
    });

    this.apply();
  }

  onunload() {
    document.body.removeClass("nwc-active");
    document.body.style.removeProperty("--nwc-width");
  }

  value() { return this.settings.unit === "px" ? this.settings.px : this.settings.percent; }

  label() { return this.value() + this.settings.unit; }

  setValue(v) {
    const [min, max] = LIMITS[this.settings.unit];
    v = Math.round(Math.min(max, Math.max(min, Number(v) || min)));
    if (this.settings.unit === "px") this.settings.px = v; else this.settings.percent = v;
  }

  async nudge(dir) {
    const step = this.settings.unit === "px" ? this.settings.step : 5;
    this.setValue(this.value() + dir * step);
    this.settings.enabled = true;
    await this.save();
  }

  apply() {
    const s = this.settings;
    document.body.toggleClass("nwc-active", s.enabled);
    document.body.style.setProperty("--nwc-width", this.label());
    this.statusEl.toggle(s.showStatusBar);
    this.statusEl.setText(s.enabled ? "↔ " + this.label() : "↔ off");
  }

  async save() {
    this.apply();
    await this.saveData(this.settings);
  }
}

class WidthModal extends Modal {
  constructor(app, plugin) { super(app); this.plugin = plugin; }

  onOpen() {
    const p = this.plugin;
    this.modalEl.addClass("nwc-modal");
    this.titleEl.setText("Text width");
    const c = this.contentEl;
    c.empty();

    const row = c.createDiv("nwc-row");
    const slider = row.createEl("input", { type: "range" });
    const out = row.createSpan("nwc-value");
    const sync = () => {
      const [min, max] = LIMITS[p.settings.unit];
      slider.min = min; slider.max = max;
      slider.step = p.settings.unit === "px" ? 10 : 1;
      slider.value = p.value();
      out.setText(p.label());
    };
    slider.addEventListener("input", async () => {
      p.setValue(slider.value);
      p.settings.enabled = true;
      out.setText(p.label());
      await p.save();
    });

    new Setting(c).setName("Unit").addDropdown((d) =>
      d.addOption("px", "Pixels (fixed width)")
        .addOption("%", "Percent of the pane")
        .setValue(p.settings.unit)
        .onChange(async (v) => { p.settings.unit = v; await p.save(); sync(); presets(); }));

    const presetBox = c.createDiv("nwc-presets");
    const presets = () => {
      presetBox.empty();
      const list = p.settings.unit === "px" ? [700, 900, 1100, 1300, 1600] : [60, 70, 80, 90, 100];
      for (const v of list) {
        const b = presetBox.createEl("button", { text: v + p.settings.unit });
        b.addEventListener("click", async () => { p.setValue(v); p.settings.enabled = true; await p.save(); sync(); });
      }
    };

    sync();
    presets();
  }

  onClose() { this.contentEl.empty(); }
}

class NWCSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  display() {
    const p = this.plugin;
    const c = this.containerEl;
    c.empty();

    new Setting(c).setName("Use custom width")
      .setDesc("Works in both editing and reading view, whether Obsidian's 'Readable line length' is on or off.")
      .addToggle((t) => t.setValue(p.settings.enabled).onChange(async (v) => { p.settings.enabled = v; await p.save(); }));

    new Setting(c).setName("Unit")
      .setDesc("Pixels keep the same width on any window size. Percent grows and shrinks with the pane.")
      .addDropdown((d) => d.addOption("px", "Pixels").addOption("%", "Percent")
        .setValue(p.settings.unit)
        .onChange(async (v) => { p.settings.unit = v; await p.save(); this.display(); }));

    const [min, max] = LIMITS[p.settings.unit];
    let text;
    new Setting(c).setName("Width")
      .setDesc(`Between ${min} and ${max}${p.settings.unit}. Obsidian's normal readable width is 700px.`)
      .addSlider((s) => {
        s.setLimits(min, max, p.settings.unit === "px" ? 10 : 1)
          .setValue(p.value()).setDynamicTooltip();
        // Obsidian's onChange only fires when you let go of the slider,
        // so listen to "input" to update the width while dragging.
        s.sliderEl.addEventListener("input", () => {
          p.setValue(s.sliderEl.value);
          text.setValue(String(p.value()));
          p.apply();
        });
        s.onChange(async (v) => { p.setValue(v); text.setValue(String(p.value())); await p.save(); });
      })
      .addText((t) => {
        text = t;
        t.inputEl.type = "number";
        t.inputEl.addClass("nwc-number");
        t.setValue(String(p.value())).onChange(async (v) => {
          if (v === "") return;
          p.setValue(v); await p.save();
        });
      });

    new Setting(c).setName("Step size (px)")
      .setDesc("How much the 'Make text wider / narrower' commands change the width. Percent mode always uses 5%.")
      .addText((t) => {
        t.inputEl.type = "number";
        t.setValue(String(p.settings.step)).onChange(async (v) => {
          const n = Math.round(Number(v));
          if (n > 0) { p.settings.step = n; await p.save(); }
        });
      });

    new Setting(c).setName("Show in status bar")
      .setDesc("Shows the current width at the bottom. Click it to change the width quickly.")
      .addToggle((t) => t.setValue(p.settings.showStatusBar).onChange(async (v) => { p.settings.showStatusBar = v; await p.save(); }));

    new Setting(c).setName("Reset").addButton((b) => b.setButtonText("Reset to defaults").onClick(async () => {
      Object.assign(p.settings, DEFAULTS); await p.save(); this.display();
    }));
  }
}

module.exports = NoteWidthChanger;
