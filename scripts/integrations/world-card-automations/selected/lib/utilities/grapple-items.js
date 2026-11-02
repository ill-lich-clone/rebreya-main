// CPR 1.5.44, MIT. Only the two subordinate actions created by Grapple.
export const grappleItems = {
  "Grapple: Escape": {
    "name": "Grapple: Escape",
    "type": "feat",
    "img": "icons/skills/movement/arrows-up-trio-red.webp",
    "system": {
      "description": {
        "value": "",
        "chat": ""
      },
      "source": {
        "custom": "",
        "revision": 1,
        "rules": "2014"
      },
      "uses": {
        "max": "",
        "spent": 0,
        "recovery": []
      },
      "type": {
        "value": "",
        "subtype": ""
      },
      "prerequisites": {
        "level": null,
        "items": [],
        "repeatable": false
      },
      "properties": [],
      "requirements": "",
      "activities": {
        "dnd5eactivity000": {
          "_id": "dnd5eactivity000",
          "type": "utility",
          "activation": {
            "type": "action",
            "value": 1,
            "condition": "",
            "override": false
          },
          "consumption": {
            "targets": [],
            "scaling": {
              "allowed": false,
              "max": ""
            },
            "spellSlot": true
          },
          "description": {
            "chatFlavor": ""
          },
          "duration": {
            "concentration": false,
            "value": "",
            "units": "inst",
            "special": "",
            "override": false
          },
          "effects": [],
          "range": {
            "units": "self",
            "special": "",
            "override": false
          },
          "target": {
            "template": {
              "count": "",
              "contiguous": false,
              "type": "",
              "size": "",
              "width": "",
              "height": "",
              "units": "ft"
            },
            "affects": {
              "count": "",
              "type": "",
              "choice": false,
              "special": ""
            },
            "prompt": true,
            "override": false
          },
          "uses": {
            "spent": 0,
            "max": "",
            "recovery": []
          },
          "roll": {
            "formula": "",
            "name": "",
            "prompt": false,
            "visible": false
          },
          "sort": 0,
          "useConditionText": "",
          "forceDialog": false,
          "effectConditionText": "",
          "midiAutomationOnly": false,
          "useConditionReason": "",
          "macroData": {
            "name": "",
            "command": ""
          },
          "ignoreTraits": {
            "idi": false,
            "idr": false,
            "idv": false,
            "ida": false,
            "idm": false
          },
          "midiProperties": {
            "ignoreTraits": [],
            "triggeredActivityId": "none",
            "triggeredActivityConditionText": "",
            "triggeredActivityTargets": "targets",
            "triggeredActivityRollAs": "self",
            "forceDialog": false,
            "forceAttackDialog": false,
            "forceDamageDialog": false,
            "confirmTargets": "default",
            "autoTargetType": "any",
            "autoTargetAction": "default",
            "automationOnly": false,
            "otherActivityCompatible": true,
            "otherActivityAsParentType": true,
            "identifier": "",
            "displayActivityName": false,
            "rollMode": "default",
            "chooseEffects": false,
            "toggleEffect": false,
            "ignoreFullCover": false,
            "removeChatButtons": "default",
            "magicEffect": false,
            "magicDamage": false,
            "noConcentrationCheck": false,
            "autoCEEffects": "default"
          },
          "isOverTimeFlag": false,
          "overTimeProperties": {
            "saveRemoves": true,
            "preRemoveConditionText": "",
            "postRemoveConditionText": ""
          },
          "otherActivityId": "none"
        }
      },
      "identifier": "grapple-escape",
      "enchant": {},
      "advancement": [],
      "crewed": false
    },
    "effects": [],
    "flags": {
      "midiProperties": {
        "confirmTargets": "default",
        "autoFailFriendly": false,
        "autoSaveFriendly": false,
        "critOther": false,
        "offHandWeapon": false,
        "magicdam": false,
        "magiceffect": false,
        "noConcentrationCheck": false,
        "toggleEffect": false,
        "ignoreTotalCover": false,
        "idr": false,
        "idi": false,
        "idv": false,
        "ida": false
      },
      "midi-qol": {
        "rollAttackPerTarget": "default",
        "itemCondition": "",
        "effectCondition": "",
        "AoETargetType": "any",
        "AoETargetTypeIncludeSelf": true,
        "autoTarget": "default",
        "removeAttackDamageButtons": "default",
        "reactionCondition": "",
        "otherCondition": ""
      },
      "chris-premades": {
        "macros": {
          "midi": {
            "item": [
              "grappleEscape"
            ]
          }
        }
      },
      "dnd5e": {
        "riders": {
          "activity": [],
          "effect": []
        }
      }
    }
  },
  "Grappler: Pin": {
    "name": "Grappler: Pin",
    "type": "feat",
    "img": "icons/skills/melee/unarmed-punch-fist.webp",
    "system": {
      "activities": {
        "WD6Jj0oxh0AnM6HO": {
          "type": "utility",
          "_id": "WD6Jj0oxh0AnM6HO",
          "sort": 0,
          "activation": {
            "type": "action",
            "value": null,
            "override": false,
            "condition": ""
          },
          "consumption": {
            "scaling": {
              "allowed": false
            },
            "spellSlot": true,
            "targets": []
          },
          "description": {
            "chatFlavor": ""
          },
          "duration": {
            "units": "inst",
            "concentration": false,
            "override": false
          },
          "effects": [],
          "range": {
            "override": false,
            "units": "ft",
            "special": "",
            "value": "5"
          },
          "target": {
            "template": {
              "contiguous": false,
              "units": "ft",
              "type": ""
            },
            "affects": {
              "choice": false,
              "type": "creature",
              "special": "",
              "count": "1"
            },
            "override": false,
            "prompt": true
          },
          "uses": {
            "spent": 0,
            "recovery": [],
            "max": ""
          },
          "roll": {
            "prompt": false,
            "visible": false,
            "formula": "",
            "name": ""
          },
          "useConditionText": "",
          "useConditionReason": "",
          "effectConditionText": "",
          "macroData": {
            "name": "",
            "command": ""
          },
          "ignoreTraits": {
            "idi": false,
            "idr": false,
            "idv": false,
            "ida": false
          },
          "midiProperties": {
            "ignoreTraits": [],
            "triggeredActivityId": "none",
            "triggeredActivityConditionText": "",
            "triggeredActivityTargets": "targets",
            "triggeredActivityRollAs": "self",
            "forceDialog": false,
            "confirmTargets": "default",
            "autoTargetType": "any",
            "autoTargetAction": "default",
            "automationOnly": false,
            "otherActivityCompatible": true,
            "identifier": "",
            "displayActivityName": false,
            "rollMode": "default",
            "chooseEffects": false
          },
          "isOverTimeFlag": false,
          "overTimeProperties": {
            "saveRemoves": true,
            "preRemoveConditionText": "",
            "postRemoveConditionText": ""
          },
          "name": "",
          "img": "",
          "appliedEffects": []
        }
      },
      "uses": {
        "spent": 0,
        "recovery": [],
        "max": ""
      },
      "description": {
        "value": "",
        "chat": ""
      },
      "identifier": "grappler-pin",
      "source": {
        "revision": 1,
        "rules": "2014",
        "book": "",
        "page": "",
        "custom": "",
        "license": ""
      },
      "advancement": [],
      "cover": null,
      "crewed": false,
      "enchant": {},
      "prerequisites": {
        "level": null,
        "repeatable": false
      },
      "properties": [],
      "requirements": "",
      "type": {
        "value": "",
        "subtype": ""
      }
    },
    "effects": [],
    "flags": {
      "midiProperties": {
        "confirmTargets": "default",
        "autoFailFriendly": false,
        "autoSaveFriendly": false,
        "critOther": false,
        "offHandWeapon": false,
        "magicdam": false,
        "magiceffect": false,
        "noConcentrationCheck": false,
        "toggleEffect": false,
        "ignoreTotalCover": false,
        "idr": false,
        "idi": false,
        "idv": false,
        "ida": false
      },
      "midi-qol": {
        "rollAttackPerTarget": "default",
        "itemCondition": "",
        "effectCondition": ""
      },
      "dnd5e": {
        "riders": {
          "activity": [],
          "effect": []
        }
      },
      "chris-premades": {
        "macros": {
          "midi": {
            "item": [
              "grapplerPin"
            ]
          }
        },
        "info": {
          "identifier": "grapplerPin",
          "source": "chris-premades",
          "rules": "legacy",
          "version": "1.1.0"
        }
      }
    }
  }
};
