import { objectSearch } from "../utils/object-search";

export class ForbiddenLandsActor extends Actor {
	get actorProperties() {
		return this.data.data;
	}

	get attributes() {
		return this.actorProperties.attribute;
	}

	get conditions() {
		return this.actorProperties.condition;
	}

	get consumables() {
		return this.actorProperties.consumable;
	}

	get isBroken() {
		return Object.values(this.attributes).some((attribute) => attribute.value <= 0 && attribute.max > 0);
	}

	get skills() {
		return this.actorProperties.skill;
	}

	get willpower() {
		return this.actorProperties.bio.willpower;
	}

	/* Override */
	getRollData() {
		return {
			alias: this.token?.name || this.name,
			actorId: this.id,
			actorType: this.data.type,
			isBroken: this.isBroken,
			sceneId: this.token?.parent.id,
			tokenId: this.token?.id,
			willpower: this.willpower,
		};
	}

	getRollModifierOptions(...rollIdentifiers) {
		return this.items.reduce((array, item) => {
			const modifier = item.getRollModifier(...rollIdentifiers);
			if (modifier) array.push(modifier);
			return array;
		}, []);
	}

	async createEmbeddedDocuments(embeddedName, data, options) {
		// Replace randomized Item.properties like "[[d6]] days" with a roll
		let newData = deepClone(data);
		if (!Array.isArray(newData)) newData = [newData]; // Small technical debt. During redesign of NPC sheet createEmbeddedDocuments needs to be passed an array.
		const inlineRoll = /\[\[([d\d+\-*]+)\]\]/i;
		const createRoll = async ([_match, group]) => {
			const roll = await new Roll(group).roll();
			return roll.total;
		};
		for await (const entity of newData) {
			if (entity.data) {
				entity.data = await Object.entries(entity.data).reduce(async (obj, [key, value]) => {
					if (typeof value === "string" && value.match(inlineRoll)) {
						const result = await createRoll(inlineRoll.exec(value));
						value = value.replace(inlineRoll, result);
					}
					const resolved = await obj;
					return { ...resolved, [key]: value };
				}, {});
			}
		}
		return super.createEmbeddedDocuments(embeddedName, newData, options);
	}

	/**
	 * Override initializing a character to set default portraits.
	 * @param {object} data object of an initialized character.
	 * @param {object?} options optional object of options.
	 */
	static async create(data, options) {
		if (!data.img) {
			switch (data.type) {
				case "party":
					data.img = "systems/forbidden-lands/assets/fbl-sun.webp";
					break;
				default:
					data.img = `systems/forbidden-lands/assets/fbl-${data.type}.webp`;
					break;
			}
		}
		super.create(data, options);
	}
}

export class ForbiddenLandsItem extends Item {
	get artifactDie() {
		return this.itemProperties.artifactBonus;
	}

	get bonus() {
		return this.itemProperties.bonus.value;
	}

	get damage() {
		return this.itemProperties.damage;
	}

	get category() {
		return this.itemProperties.category;
	}

	get itemProperties() {
		return this.data.data;
	}

	get isBroken() {
		return this.bonus <= 0;
	}

	get range() {
		return this.itemProperties.range;
	}

	get rollModifiers() {
		return this.itemProperties.rollModifiers;
	}

	get type() {
		return this.data.type;
	}

	/* Override */
	getRollData() {
		return {
			artifactDie: this.artifactDie,
			value: this.bonus || 0,
			category: this.category,
			damage: this.damage || 0,
			isBroken: this.isBroken,
			itemId: this.id,
			label: this.name,
			name: this.name,
			range: this.range,
			type: this.type,
		};
	}

	getRollModifier(...rollIdentifiers) {
		if (!this.rollModifiers || foundry.utils.isObjectEmpty(this.rollModifiers)) return null;
		const modifier = Object.values(this.rollModifiers).reduce(
			(value, mod) =>
				rollIdentifiers.includes(objectSearch(CONFIG.fbl.i18n, mod.name))
					? (value += Number(mod.value))
					: value,
			0,
		);
		if (!modifier) return null;
		return {
			name: this.name,
			value: modifier > 0 ? `+${modifier}` : modifier.toFixed(),
			active: modifier < 0 ? true : false,
		};
	}

	async sendToChat() {
		const itemData = this.data.toObject();
		if (itemData.img.includes("/mystery-man")) {
			itemData.img = null;
		}
		if (CONFIG.fbl.itemTypes.includes(itemData.type)) itemData[`is${itemData.type.capitalize()}`] = true;
		itemData.hasRollModifiers =
			itemData.data.rollModifiers && Object.values(itemData.data.rollModifiers).length > 0;
		const html = await renderTemplate("systems/forbidden-lands/templates/chat/item.hbs", itemData);
		const chatData = {
			user: game.userId,
			rollMode: game.settings.get("core", "rollMode"),
			content: html,
		};
		if (["gmroll", "blindroll"].includes(chatData.rollMode)) {
			chatData.whisper = ChatMessage.getWhisperRecipients("GM");
		} else if (chatData.rollMode === "selfroll") {
			chatData.whisper = [game.user];
		}
		const message = await ChatMessage.create(chatData);
		const healingTime = message.data.content.match(/data-type="healtime.+?<\/i> (\d+?)<\/a>/);
		if (healingTime) itemData.data.healingTime = healingTime[1] + " days";
		await message.setFlag("forbidden-lands", "itemData", itemData); // Adds posted item data to chat message flags for item drag/drop
	}
}
