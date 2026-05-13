// Импорт черт V0.8 в Foundry D&D5e
// Стиль: один раз запускаешь макрос, выбираешь JSON-файл cherty-v08-foundry-2014-bundle.json или cherty-v08-foundry-2014-items.json
// Он создаёт папки по разделам и импортирует черты как Item[type=feat]

const input = document.createElement('input')
input.type = 'file'
input.accept = '.json,application/json'
input.click()

input.addEventListener('change', async () => {
    const file = input.files?.[0]
    if (!file) return

    const text = await file.text()
    const parsed = JSON.parse(text)
    const items = Array.isArray(parsed) ? parsed : parsed.items

    if (!Array.isArray(items)) {
        ui.notifications.error('В JSON не найден массив черт. Потому что даже JSON иногда выбирает насилие.')
        return
    }

    const rootName = 'Черты V0.8'
    let root = game.folders.find(f => f.type === 'Item' && f.name === rootName)
    if (!root) {
        root = await Folder.create({ name: rootName, type: 'Item' })
    }

    const folderBySection = new Map()

    for (const item of items) {
        const section = item.flags?.teyvankal?.section || 'Без раздела'
        const key = section

        if (!folderBySection.has(key)) {
            let folder = game.folders.find(f => f.type === 'Item' && f.name === section && f.folder?.id === root.id)
            if (!folder) {
                folder = await Folder.create({ name: section, type: 'Item', folder: root.id })
            }
            folderBySection.set(key, folder)
        }

        item.folder = folderBySection.get(key).id
    }

    const created = await Item.createDocuments(items, { keepId: false })
    ui.notifications.info(`Импортировано черт: ${created.length}`)
})
