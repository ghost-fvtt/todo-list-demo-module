/**
 * A single ToDo in our list of Todos.
 * @typedef {Object} ToDo
 * @property {string} id - A unique ID to identify this todo.
 * @property {string} label - The text of the todo.
 * @property {boolean} isDone - Marks whether the todo is done.
 * @property {string} userId - The user who owns this todo.
 */

/**
 * A class which holds some constants for todo-list
 */
class ToDoList {
    static ID = "todo-list";

    static FLAGS = {
        TODOS: "todos",
    };

    static TEMPLATES = {
        TODOLIST: `modules/${this.ID}/templates/todo-list.hbs`,
    };

    static SETTINGS = {
        INJECT_BUTTON: "inject-button",
    };

    static _TO_DO_LIST_CONFIGS = {};

    /**
     * A small helper function which leverages developer mode flags to gate debug logs.
     *
     * @param {boolean} force - forces the log even if the debug flag is not on
     * @param  {...any} args - what to log
     */
    static log(force, ...args) {
        const shouldLog = force || game.modules.get("_dev-mode")?.api?.getPackageDebugValue(this.ID);

        if (shouldLog) {
            console.log(this.ID, "|", ...args);
        }
    }

    static toDoListConfigForUserId(userId) {
        if (!(userId in this._TO_DO_LIST_CONFIGS)) {
            this._TO_DO_LIST_CONFIGS[userId] = new ToDoListConfig(userId);
        }

        return this._TO_DO_LIST_CONFIGS[userId];
    }

    static initialize() {
        game.settings.register(this.ID, this.SETTINGS.INJECT_BUTTON, {
            name: `TODO-LIST.settings.${this.SETTINGS.INJECT_BUTTON}.Name`,
            default: true,
            type: Boolean,
            scope: "client",
            config: true,
            hint: `TODO-LIST.settings.${this.SETTINGS.INJECT_BUTTON}.Hint`,
            onChange: () => ui.players.render(),
        });
    }
}

Hooks.once("init", () => {
    ToDoList.initialize();
});

/**
 * Register our module's debug flag with developer mode's custom hook
 */
Hooks.once("devModeReady", ({ registerPackageDebugFlag }) => {
    registerPackageDebugFlag(ToDoList.ID);
});

class ToDoListData {
    static getToDosForUser(userId) {
        return game.users.get(userId)?.getFlag(ToDoList.ID, ToDoList.FLAGS.TODOS);
    }

    static createToDo(userId, toDoData) {
        // generate a random id for this new ToDo and populate the userId
        const newToDo = {
            isDone: false,
            ...toDoData,
            id: foundry.utils.randomID(16),
            userId,
        };

        // construct the update to insert the new ToDo
        const newToDos = {
            [newToDo.id]: newToDo,
        };

        // update the database with the new ToDos
        return game.users.get(userId)?.setFlag(ToDoList.ID, ToDoList.FLAGS.TODOS, newToDos);
    }

    static get allToDos() {
        const allToDos = game.users.reduce((accumulator, user) => {
            const userTodos = this.getToDosForUser(user.id);

            return {
                ...accumulator,
                ...userTodos,
            };
        }, {});

        return allToDos;
    }

    static updateToDo(toDoId, updateData) {
        const relevantToDo = this.allToDos[toDoId];

        // construct the update to send
        const update = {
            [toDoId]: updateData,
        };

        // update the database with the updated ToDo list
        return game.users.get(relevantToDo.userId)?.setFlag(ToDoList.ID, ToDoList.FLAGS.TODOS, update);
    }

    static deleteToDo(toDoId) {
        const relevantToDo = this.allToDos[toDoId];

        // Foundry specific syntax required to delete a key from a persisted object in the database
        const keyDeletion = {
            [`-=${toDoId}`]: null,
        };

        // update the database with the updated ToDo list
        return game.users.get(relevantToDo.userId)?.setFlag(ToDoList.ID, ToDoList.FLAGS.TODOS, keyDeletion);
    }

    static updateUserToDos(userId, updateData) {
        return game.users.get(userId)?.setFlag(ToDoList.ID, ToDoList.FLAGS.TODOS, updateData);
    }
}

Hooks.on("renderPlayerList", (playerList, html) => {
    if (!game.settings.get(ToDoList.ID, ToDoList.SETTINGS.INJECT_BUTTON)) {
        return;
    }

    // find the element which has our logged in user's id
    const loggedInUserListItem = html.find(`[data-user-id="${game.userId}"]`);

    // create localized tooltip
    const tooltip = game.i18n.localize("TODO-LIST.button-title");

    // insert a button at the end of this element
    loggedInUserListItem.append(
        `<button type="button" class="todo-list-icon-button flex0" title="${tooltip}"><i class="fas fa-tasks"></i></button>`
    );

    html.on("click", ".todo-list-icon-button", (event) => {
        const userId = $(event.currentTarget).parents("[data-user-id]")?.data()?.userId;
        ToDoList.toDoListConfigForUserId(userId).render(true);
    });
});

class ToDoListConfig extends FormApplication {
    static get defaultOptions() {
        const defaults = super.defaultOptions;

        const overrides = {
            height: "auto",
            id: "todo-list",
            template: ToDoList.TEMPLATES.TODOLIST,
            title: "To Do List",
            closeOnSubmit: false, // do not close when submitted
            submitOnChange: true, // submit when any input changes
        };

        const mergedOptions = foundry.utils.mergeObject(defaults, overrides);

        return mergedOptions;
    }

    get userId() {
        return this.object;
    }

    getData(options) {
        return {
            todos: ToDoListData.getToDosForUser(this.userId),
        };
    }

    async _updateObject(event, formData) {
        const expandedData = foundry.utils.expandObject(formData);

        await ToDoListData.updateUserToDos(this.userId, expandedData);

        this.render();
    }

    activateListeners(html) {
        super.activateListeners(html);

        html.on("click", "[data-action]", this._handleButtonClick.bind(this));
    }

    async _handleButtonClick(event) {
        const clickedElement = $(event.currentTarget);
        const action = clickedElement.data().action;
        const toDoId = clickedElement.parents("[data-todo-id]")?.data()?.todoId;

        switch (action) {
            case "create": {
                await ToDoListData.createToDo(this.userId);
                this.render();
                break;
            }

            case "delete": {
                const confirmed = await Dialog.confirm({
                    title: game.i18n.localize("TODO-LIST.confirms.deleteConfirm.Title"),
                    content: game.i18n.localize("TODO-LIST.confirms.deleteConfirm.Content"),
                });

                if (confirmed) {
                    await ToDoListData.deleteToDo(toDoId);
                    this.render();
                }

                break;
            }

            default:
                ToDoList.log(false, "Invalid action detected", action);
        }
    }
}
