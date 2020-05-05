let fastify = require('fastify')({ logger: true });
fastify.register(require('fastify-postgres'), {
    connectionString: 'postgres://docker:docker@localhost:5432/docker'
});
fastify.addContentTypeParser('application/json', { parseAs: 'string' }, function (req, body, done) {
    try {
        let json = { };
        if(body){
            json = JSON.parse(body)
        }
        done(null, json)
    } catch (err) {
        err.statusCode = 400;
        done(err, undefined)
    }
});

//TODO ROUTES
fastify.post('/api/forum/create', createForumHandler);
fastify.post('/api/forum/:slug/create', createThreadHandler);
fastify.get('/api/forum/:slug/details', getForumProfileHandler);
fastify.get('/api/forum/:slug/threads', getForumThreads);
fastify.get('/api/forum/:slug/users', getUsersFromForum);
fastify.post('/api/post/:id/details', modifyPost);
fastify.get('/api/post/:id/details', getPostDetails);
fastify.post('/api/service/clear', clearDB);
fastify.get('/api/service/status', getServiceStatus);
fastify.post('/api/thread/:slug_or_id/create', createPosts);
fastify.get('/api/thread/:slug_or_id/details', getThreadDetails);
fastify.post('/api/thread/:slug_or_id/details', modifyThread);
fastify.get('/api/thread/:slug_or_id/posts', getPostsFromThread);
fastify.post('/api/thread/:slug_or_id/vote', toVote);
fastify.post('/api/user/:nickname/create', createUserHandler);
fastify.get('/api/user/:nickname/profile', getUserProfile);
fastify.post('/api/user/:nickname/profile', modifyUserProfile);






//TODO ERRORS
class ErrorResponse{
    constructor(code, response) {
        this._code = code;
        this._response = response;
    }

    send(reply){
        reply.code(this._code);
        return this._response;
    }
}


//TODO UTILS
function response(reply, code, message){
    reply.code(code);
    return message;
}






//TODO HANDLERS

async function createUserHandler(request, reply){
    let userModel = new UserModel(request.body);
    userModel.nickname = request.params.nickname;

    const usersData = await UserController.getUsersByNicknameOrEmail(userModel);
    if(usersData.length > 0){
        return response(reply, 409, usersData);
    }

    await UserController.createUser(userModel);
    return response(reply, 201, userModel.get());
}


async function getUserProfile(request, reply){
    let userModel = new UserModel(request.body);
    userModel.nickname = request.params.nickname;

    const usersData = await UserController.getUsersByNickname(userModel);
    if(usersData.length){
        return response(reply, 200, usersData[0]);
    }
    return response(reply, 404, {'message':'user not found'});
}


async function modifyUserProfile(request, reply){
    let userModel = new UserModel(request.body);
    userModel.nickname = request.params.nickname;

    const users = await UserController.getUsersByNicknameOrEmail(userModel);

    if(users.length > 1){
        return response(reply, 409, {'message':'conflict update user'});
    }

    if(users.length < 1){
        return response(reply, 404, {'message':'user not found'});
    }

    userModel.updateInstance(users[0]);
    await UserController.modifyUser(userModel);
    return response(reply, 200, userModel.get());
}


async function createForumHandler(request, reply) {
    let forumModel = new ForumModel(request.body);

    const users = await UserController.getUsersByNickname({nickname: forumModel.user});
    if(!users.length){
        return response(reply, 404,{'message':'user not found'});
    }

    const forumData = await ForumController.getForumBySlug(forumModel);
    if(forumData.length){
        return response(reply, 409, (new ForumModel(forumData[0])).get());
    }

    forumModel.user = users[0].nickname;
    await ForumController.createNewForum(forumModel);
    return response(reply, 201, forumModel.get());
}


async function getForumProfileHandler(request, reply){
    let forumModel = new ForumModel();
    forumModel.slug = request.params.slug;

    const forumData = await ForumController.getForumBySlug(forumModel);
    if(forumData.length){
        return response(reply, 200, (new ForumModel(forumData[0])).get());
    }

    return response(reply, 404, {'message':'forum not found'});
}


async function createThreadHandler(request, reply){
    let threadModel = new ThreadModel(request.body);

    const userData = await UserController.getUsersByNickname({nickname: threadModel.author});
    if(!userData.length){
        return response(reply, 404, {'message':'user not found'});
    }

    const forumData = await ForumController.getForumBySlug({slug: request.params.slug});
    if(!forumData.length){
        return response(reply, 404, {'message':'forum not found'});
    }

    const threads = await ThreadController.getThreadBySlugOrTitle(threadModel);
    if(threads.length){
        return response(reply, 409, threads[0]);
    }

    threadModel.forum = forumData[0].slug;
    await ThreadController.createThread(threadModel);
    const outThreadData = await ThreadController.getThreadBySlugOrTitle(threadModel);

    forumData[0].threads += 1;
    await ForumController.modifyForum(forumData[0]);

    const match = await ForumUsersController.getMatchFromUsersForum({
        nickname: threadModel.author,
        forum: request.params.slug
    });
    console.log('MATCH', match);
    if(!match.length){
        await ForumUsersController.addUserToUsersForum({
            nickname: threadModel.author,
            forum: request.params.slug
        });
    }

    return response(reply, 201, outThreadData[0]);
}


async function getForumThreads(request, reply){
    let forumModel = new ForumModel();
    forumModel.slug = request.params.slug;
    forumModel.desc = request.query.desc === 'true';
    forumModel.limit = request.query.limit ? request.query.limit : 100;
    forumModel.since = request.query.since;

    const forum = await ForumController.getForumBySlug(forumModel);
    if(!forum.length){
        return response(reply, 404, {'message':'thread not found'});
    }

    const threads = await ForumController.getThreadsFromForum(forumModel);
    return response(reply, 200, threads);
}


async function createPosts(request, reply){
    let posts = request.body;
    const slug_or_id = request.params.slug_or_id;
    const date = new Date();

    const threads = await ThreadController.getThreadBySlugOrId(slug_or_id);
    if(!threads.length){
        return response(reply, 404, {'message':'thread not found'});
    }

    for (let post of posts){
        const usersData = await UserController.getUsersByNickname({nickname:post.author});
        if(!usersData.length){
            console.log('NOT FOUND', usersData);
            return response(reply, 404, {'message':'user not found'});
        }

        if(post.parent){
            const postData = await PostsController.getPostById(post.parent);
            if(!postData.length){
                return response(reply, 409, {'message':'post parent not found'});
            }

            if(threads[0].id !== postData[0].thread){
                return response(reply, 409, {'message': 'another thread'});
            }
            post.level = postData[0].level + 1;
            post.tree = postData[0].tree;
            post.path = postData[0].path + Date.now().toString(36);
        } else {
            post.tree = Date.now();
            post.level = 0;
            post.path = Date.now().toString(36);
            post.parent = 0;
        }

        post.thread = threads[0].id;
        post.forum = threads[0].forum;
        post.created = date.toISOString();
        post.id = await PostsController.createPosts(post);

        const match = await ForumUsersController.getMatchFromUsersForum({
            nickname:post.author,
            forum:post.forum
        });
        if(!match.length){
            await ForumUsersController.addUserToUsersForum({
                nickname:post.author,
                forum:post.forum
            });
        }
    }

    const forumData = await ForumController.getForumBySlug({slug: threads[0].forum});
    forumData[0].posts += posts.length;
    await ForumController.modifyForum(forumData[0]);
    
    return response(reply, 201, posts);
}


async function getThreadDetails(request, reply){
    const slug_or_id = request.params.slug_or_id;
    const threads = await ThreadController.getThreadBySlugOrId(slug_or_id);

    if(!threads.length){
        return response(reply, 404, {'message':'thread not found'});
    }

    return response(reply, 200, threads[0]);
}


async function toVote(request, reply){
    let vote = request.body;
    vote.thread = request.params.slug_or_id;

    let threads = await ThreadController.getThreadBySlugOrId(vote.thread);
    if(!threads.length){
        return response(reply, 404, {'message':'thread not found'});
    }

    const usersData = await UserController.getUsersByNickname({nickname:vote.nickname});
    if(!usersData.length){
        return response(reply, 404, {'message':'user not found'});
    }

    vote.thread = threads[0].id;
    const voteData = await VotesController.getVoteBySlugOrIdAndNickname(vote);
    if(!voteData.length){
        threads[0].votes += vote.voice;
        await VotesController.createVote(vote);
    } else {
        threads[0].votes = threads[0].votes - voteData[0].voice + vote.voice;
        await VotesController.modifyVote(vote);
    }

    await ThreadController.modifyThread(threads[0]);
    return response(reply, 200, threads[0]);
}


async function modifyThread(request, reply){
    const thread = request.body;
    const slug_or_id = request.params.slug_or_id;

    let threadData = await ThreadController.getThreadBySlugOrId(slug_or_id);
    if(!threadData.length){
        return response(reply, 404, {'message':'thread not found'});
    }

    threadData[0].message = thread.message ? thread.message : threadData[0].message;
    threadData[0].title = thread.title ? thread.title : threadData[0].title;

    await ThreadController.modifyThread(threadData[0]);
    return response(reply, 200, threadData[0]);
}

async function getUsersFromForum(request, reply) {  //TODO POPEX
    let context = {};
    context.forum = request.params.slug;
    context.limit = request.query.limit ? request.query.limit : 100;
    context.since = request.query.since;
    context.desc = (request.query.desc === 'true');

    const forumData = await ForumController.getForumBySlug({slug:context.forum});
    if(!forumData.length){
        return response(reply, 404, {'message':'forum not found'});
    }

    const usersData = await ForumUsersController.getUsersFromForum(context);
    return response(reply, 200, usersData);
}

async function getServiceStatus(request, reply){
    const user = await StatusController.getUserStatus();
    const forum = await StatusController.getForumStatus();
    const thread = await StatusController.getThreadStatus();
    const post = await StatusController.getPostStatus();
    return response(reply, 200, Object.assign({}, forum, post, thread, user));
}

async function clearDB(request, reply){
    const client = await fastify.pg.connect();
    await client.query(
        'TRUNCATE users, forums, threads, posts, votes'
    )
    client.release();
    return response(reply, 200, null);
}

async function modifyPost(request, reply){
    let post = {};
    post.message = request.body.message;
    post.id = request.params.id;

    let postData = await PostsController.getPostById(post.id);
    if(!postData.length){
        return response(reply, 404, {'message':'post not found'});
    }

    if(post.message && post.message !== postData[0].message){
        await PostsController.modifyPost(post);
        postData[0].isEdited = true;
        postData[0].message = post.message;
    }
    delete postData[0].level;
    return response(reply, 200, postData[0]);
}


async function getPostDetails(request, reply){
    const id = request.params.id;
    const related = request.query && request.query.related ? request.query.related.split(',') : [];
    let out = {}

    const postData = await PostsController.getPostById(id);
    if(!postData.length){
        return response(reply, 404, {'message':'post not found'});
    }
    delete postData[0].level;
    out.post = postData[0];

    if(related.includes('thread')){
        const threadData = await ThreadController.getThreadBySlugOrId(out.post.thread);
        out.thread = threadData[0];
    }

    if(related.includes('forum')){
        const forumData = await ForumController.getForumBySlug({slug: out.post.forum});
        out.forum = forumData[0];
        out.forum.user = out.forum.username;
        delete out.forum.username;
    }

    if(related.includes('user')){
        const userData = await UserController.getUsersByNickname({nickname: out.post.author});
        out.author = userData[0];
    }

    out.post.isEdited = out.post.isedited;
    delete out.post.isedited;
    return response(reply, 200, out);
}


async function getPostsFromThread(request, reply){
    let context = {};
    context.slug_or_id = request.params.slug_or_id;
    context.sort = request.query && request.query.sort ? request.query.sort.split(',') : [];
    context.limit = request.query.limit ? request.query.limit : 100;
    context.since = request.query.since;
    context.desc = (request.query.desc === 'true');

    const threadData = await ThreadController.getThreadBySlugOrId(context.slug_or_id);
    if(!threadData.length){
        return response(reply, 404, {'message':'thread not found'});
    }
    context.id = threadData[0].id;

    if(context.sort.includes('parent_tree')){
        console.log('TESTING', await ThreadController.test(context));
        const postsData = await ThreadController.getPostsParentTree(context);
        return response(reply, 200, postsData);
    }

    if(context.sort.includes('tree')){
        const postsData = await ThreadController.getPostsTree(context);
        return response(reply, 200, postsData);
    }

    const postsData = await ThreadController.getPostsFromThread(context);
    return response(reply, 200, postsData);
}







//TODO MODELS

class UserModel{
    constructor(object) {
        this._instance = object ? object : {};
    }

    updateInstance(object){
        for (let key in object){
            if(!this[key]){
                this[key] = object[key];
            }
        }
    }

    set about(about){this._instance.about = about}
    set email(email){this._instance.email = email}
    set fullname(fullname){this._instance.fullname = fullname}
    set nickname(nickname){this._instance.nickname = nickname}

    get about(){return this._instance.about}
    get email(){return this._instance.email}
    get fullname(){return this._instance.fullname}
    get nickname(){return this._instance.nickname}

    get(){return this._instance}
}


class ForumModel{
    constructor(object) {
        this._instance = object ? object : {};
        this._clearInstance();
    }

    _clearInstance(){
        if('username' in this._instance){
            this.user = this._instance.username;
            delete this._instance.username;
        }
    }

    set posts(posts){this._instance.posts = posts}
    set slug(slug){this._instance.slug = slug}
    set threads(threads){this._instance.threads = threads}
    set title(title){this._instance.title = title}
    set user(user){this._instance.user = user}
    set limit(limit){this._limit = limit}
    set since(since){this._since = since}
    set desc(desc){this._desc = desc}

    get posts(){return this._instance.posts}
    get slug(){return this._instance.slug}
    get threads(){return this._instance.threads}
    get title(){return this._instance.title}
    get user(){return this._instance.user}
    get limit(){return this._limit}
    get since(){return this._since}
    get desc(){return this._desc}

    get(){return this._instance}
}


class ThreadModel{
    constructor(object) {
        this._instance = object ? object : {};
    }

    set author(author){this._instance.author = author};
    set created(created){this._instance.created = created};
    set forum(forum){this._instance.forum = forum};
    set id(id){this._instance.id = id};
    set message(message){this._instance.message = message};
    set slug(slug){this._instance.slug = slug};
    set title(title){this._instance.title = title};
    set votes(votes){this._instance.votes = votes};

    get author(){return this._instance.author};
    get created(){return this._instance.created};
    get forum(){return this._instance.forum};
    get id(){return this._instance.id};
    get message(){return this._instance.message};
    get slug(){return this._instance.slug};
    get title(){return this._instance.title};
    get votes(){return this._instance.votes};


    get(){return this._instance}
}













//TODO CONTROLLERS

class UserController{
    static async getUsersByNicknameOrEmail(context){
        const client = await fastify.pg.connect();
        const { rows } = await client.query(
            'SELECT about, email, fullname, nickname FROM users ' +
            'WHERE LOWER(email)=LOWER($1) OR LOWER(nickname)=LOWER($2)',
            [context.email, context.nickname],
        )
        client.release();
        return rows;
    }

    static async getUsersByNickname(context){
        const client = await fastify.pg.connect();
        const { rows } = await client.query(
            'SELECT about, email, fullname, nickname FROM users ' +
            'WHERE LOWER(nickname)=LOWER($1)', [context.nickname],
        )
        client.release();
        return rows;
    }

    static async getUsersByEmail(context){
        const client = await fastify.pg.connect();
        const { rows } = await client.query(
            'SELECT about, email, fullname, nickname FROM users ' +
            'WHERE LOWER(email)=LOWER($1)', [context.email],
        )
        client.release();
        return rows;
    }

    static async createUser(context){
        const client = await fastify.pg.connect();
        await client.query(
            'INSERT INTO users(about, email, fullname, nickname) ' +
            'VALUES($1,$2,$3,$4)',
            [context.about, context.email, context.fullname, context.nickname],
        )
        client.release();
    }

    static async modifyUser(context){
        const client = await fastify.pg.connect();
        await client.query(
            'UPDATE users SET about=$1, email=$2, fullname=$3 WHERE LOWER(nickname) = LOWER($4)',
            [context.about, context.email, context.fullname, context.nickname],
        )
        client.release();
    }
}


class ForumController{
    static async getForumBySlug(context){
        const client = await fastify.pg.connect();
        const { rows } = await client.query(
            'SELECT posts, slug, threads, title, username FROM forums ' +
            'WHERE LOWER(forums.slug) = LOWER($1)',
            [context.slug],
        )
        client.release();
        return rows;
    }

    static async getThreadsFromForum(context){
        const client = await fastify.pg.connect();
        if(context.desc && context.since){
            const { rows } = await client.query(
                'SELECT author, created, forum, id, message, slug, title, votes FROM threads ' +
                'WHERE LOWER(forum) = LOWER($3) AND threads.created <= $1 ' +
                'ORDER BY threads.created DESC ' +
                'LIMIT $2 ',
                    [context.since, context.limit, context.slug],
            )
            client.release();
            return rows;
        }
        if(!context.desc && context.since){
            const { rows } = await client.query(
                'SELECT author, created, forum, id, message, slug, title, votes FROM threads ' +
                'WHERE LOWER(forum) = LOWER($3) AND threads.created >= $1 ' +
                'ORDER BY threads.created ' +
                'LIMIT $2 ',
                    [context.since, context.limit, context.slug],
            )
            client.release();
            return rows;
        }
        if(context.desc && !context.since){
            const { rows } = await client.query(
                'SELECT author, created, forum, id, message, slug, title, votes FROM threads ' +
                'WHERE LOWER(forum) = LOWER($2) ' +
                'ORDER BY threads.created DESC ' +
                'LIMIT $1 ',
                [context.limit, context.slug],
            )
            client.release();
            return rows;
        }
        const { rows } = await client.query(
            'SELECT author, created, forum, id, message, slug, title, votes FROM threads ' +
            'WHERE LOWER(forum) = LOWER($2) ' +
            'ORDER BY threads.created ' +
            'LIMIT $1 ',
            [context.limit, context.slug],
        )
        client.release();
        return rows;
    }

    static async createNewForum(context){
        const client = await fastify.pg.connect();
        await client.query(
            'INSERT INTO forums(posts, slug, threads, title, username) VALUES($1,$2,$3,$4,$5)',
            [context.posts, context.slug, context.threads, context.title, context.user],
        )
        client.release();
    }

    static async modifyForum(context){
        const client = await fastify.pg.connect();
        await client.query(
            'UPDATE forums SET posts=$1, slug=$2, threads=$3, title=$4, username=$5 WHERE LOWER(slug) = LOWER($2)',
            [context.posts, context.slug, context.threads, context.title, context.username],
        )
        client.release();
    }
}


class ThreadController{
    static async createThread(context){
        const client = await fastify.pg.connect();
        await client.query(
            'INSERT INTO threads(author, created, forum, message, slug, title, votes) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [context.author, context.created, context.forum, context.message, context.slug, context.title, context.votes],
        )
        client.release();
    }

    static async getThreadBySlugOrTitle(context){
        const client = await fastify.pg.connect();
        if(context.slug){
            const { rows } = await client.query(
                'SELECT author, created, forum, id, message, slug, title, votes FROM threads ' +
                'WHERE LOWER(threads.slug) = LOWER($1)',
                [context.slug],
            )
            client.release();
            return rows;
        }
        const { rows } = await client.query(
            'SELECT author, created, forum, id, message, slug, title, votes FROM threads ' +
            'WHERE LOWER(threads.title) = LOWER($1)',
            [context.title],
        )
        client.release();
        return rows;

    }

    static async getThreadBySlugOrId(slug_or_id){
        const client = await fastify.pg.connect();
        if(isNaN(slug_or_id)){
            const { rows } = await client.query(
                'SELECT author, created, forum, id, message, slug, title, votes FROM threads ' +
                'WHERE LOWER(threads.slug) = LOWER($1)',
                [slug_or_id],
            )
            client.release();
            return rows;
        }
        const { rows } = await client.query(
            'SELECT author, created, forum, id, message, slug, title, votes FROM threads ' +
            'WHERE threads.id = $1',
            [slug_or_id],
        )
        client.release();
        return rows;
    }

    static async modifyThread(context){
        const client = await fastify.pg.connect();
        const { rows } = await client.query(
            'UPDATE threads SET author=$1, created=$2, forum=$3, message=$4, slug=$5, title=$6, votes=$7 ' +
            'WHERE threads.id = $8 ',
            [context.author, context.created, context.forum, context.message, context.slug, context.title, context.votes, context.id],
        )
        client.release();
        return rows;
    }

    static async getFlatPostsFromThread(context){
        const client = await fastify.pg.connect();
        if(context.desc && context.since){
            const { rows } = await client.query(
                'SELECT posts.author, posts.created, posts.forum, posts.id, posts.isEdited, posts.message, posts.parent, posts.thread FROM threads ' +
                'JOIN posts ON threads.id=posts.thread ' +
                'WHERE threads.id=$2 AND posts.id > $3 ' +
                'ORDER BY posts.created, posts.id DESC ' +
                'LIMIT $1 ',
                [context.limit, context.id, context.since],
            )
            client.release();
            return rows;
        }
        if(!context.desc && context.since){
            const { rows } = await client.query(
                'SELECT posts.author, posts.created, posts.forum, posts.id, posts.isEdited, posts.message, posts.parent, posts.thread FROM threads ' +
                'JOIN posts ON threads.id=posts.thread ' +
                'WHERE threads.id=$2 AND posts.id > $3 ' +
                'ORDER BY posts.created, posts.id ASC ' +
                'LIMIT $1 ',
                [context.limit, context.id, context.since],
            )
            client.release();
            return rows;
        }
        if(context.desc && !context.since){
            const { rows } = await client.query(
                'SELECT posts.author, posts.created, posts.forum, posts.id, posts.isEdited, posts.message, posts.parent, posts.thread FROM threads ' +
                'JOIN posts ON threads.id=posts.thread ' +
                'WHERE threads.id=$2 ' +
                'ORDER BY posts.created, posts.id DESC ' +
                'LIMIT $1 ',
                [context.limit, context.id],
            )
            client.release();
            return rows;
        }
        const { rows } = await client.query(
            'SELECT posts.author, posts.created, posts.forum, posts.id, posts.isEdited, posts.message, posts.parent, posts.thread FROM threads ' +
            'JOIN posts ON threads.id=posts.thread ' +
            'WHERE threads.id=$2 ' +
            'ORDER BY posts.created, posts.id ASC ' +
            'LIMIT $1 ',
            [context.limit, context.id],
        )
        client.release();
        return rows;
    }

    static async getPostsFromThread(context){
        const client = await fastify.pg.connect();
        if(context.desc && context.since){
            const { rows } = await client.query(
                'SELECT posts.author, posts.created, posts.forum, posts.id, posts.isEdited, posts.message, posts.parent, posts.thread FROM posts ' +
                'WHERE posts.thread=$2 AND posts.id < $3 ' +
                'ORDER BY posts.id DESC ' +
                'LIMIT $1 ',
                [context.limit, context.id, context.since],
            )
            client.release();
            return rows;
        }
        if(!context.desc && context.since){
            const { rows } = await client.query(
                'SELECT posts.author, posts.created, posts.forum, posts.id, posts.isEdited, posts.message, posts.parent, posts.thread FROM posts ' +
                'WHERE posts.thread=$2 AND posts.id > $3 ' +
                'ORDER BY posts.id ASC ' +
                'LIMIT $1 ',
                [context.limit, context.id, context.since],
            )
            client.release();
            return rows;
        }
        if(context.desc && !context.since){
            const { rows } = await client.query(
                'SELECT posts.author, posts.created, posts.forum, posts.id, posts.isEdited, posts.message, posts.parent, posts.thread FROM posts ' +
                'WHERE posts.thread=$2 ' +
                'ORDER BY posts.id DESC ' +
                'LIMIT $1 ',
                [context.limit, context.id],
            )
            client.release();
            return rows;
        }
        const { rows } = await client.query(
            'SELECT posts.author, posts.created, posts.forum, posts.id, posts.isEdited, posts.message, posts.parent, posts.thread FROM posts ' +
            'WHERE posts.thread=$2 ' +
            'ORDER BY posts.id ASC ' +
            'LIMIT $1 ',
            [context.limit, context.id],
        )
        client.release();
        return rows;
    }

    static async getPostsTree(context){
        const client = await fastify.pg.connect();
        if(!context.desc && !context.since){
            const { rows } = await client.query(
                'SELECT posts.author, posts.created, posts.forum, posts.id, posts.isEdited, posts.message, posts.parent, posts.thread FROM posts ' +
                'WHERE posts.thread=$2 ' +
                'ORDER BY posts.path ' +
                'LIMIT $1 ',
                [context.limit, context.id],
            )
            client.release();
            return rows;
        }
        if(context.desc && !context.since){
            const { rows } = await client.query(
                'SELECT posts.author, posts.created, posts.forum, posts.id, posts.isEdited, posts.message, posts.parent, posts.thread FROM posts ' +
                'WHERE posts.thread=$2 ' +
                'ORDER BY posts.tree DESC, posts.path DESC ' +
                'LIMIT $1 ',
                [context.limit, context.id],
            )
            client.release();
            return rows;
        }
        if(context.desc && context.since){
            const { rows } = await client.query(
                'SELECT posts.author, posts.created, posts.forum, posts.id, posts.isEdited, posts.message, posts.parent, posts.thread FROM posts ' +
                'WHERE posts.thread=$2 AND posts.path < (SELECT posts.path FROM posts WHERE posts.id = $3) ' +
                'ORDER BY posts.tree DESC, posts.path DESC ' +
                'LIMIT $1 ',
                [context.limit, context.id, context.since],
            )
            client.release();
            return rows;
        }
        const { rows } = await client.query(
            'SELECT posts.author, posts.created, posts.forum, posts.id, posts.isEdited, posts.message, posts.parent, posts.thread FROM posts ' +
            'WHERE posts.thread=$2 AND posts.path > (SELECT posts.path FROM posts WHERE posts.id = $3) ' +
            'ORDER BY posts.path ' +
            'LIMIT $1 ',
            [context.limit, context.id, context.since],
        )
        client.release();
        return rows;
    }

    static async test(context){
        if(context.desc && context.since) {
            const client = await fastify.pg.connect();
            const {rows} = await client.query(
                '(SELECT ARRAY (SELECT posts.tree from posts WHERE posts.thread = $2 AND posts.parent = 0 AND posts.path < (SELECT posts.path FROM posts WHERE posts.id = $3) ORDER BY posts.tree DESC LIMIT $1)) ',
                [context.limit, context.id, context.since],
            )
            client.release();
            return rows;
        }
        return 'nope';
    }

    static async getPostsParentTree(context){
        const client = await fastify.pg.connect();
        if(!context.desc && !context.since){
            const { rows } = await client.query(
                'SELECT author, created, forum, id, isEdited, message, parent, thread FROM posts ' +
                'WHERE posts.thread=$2 AND ARRAY[posts.tree] && ' +
                '(SELECT ARRAY (SELECT posts.tree from posts WHERE posts.thread = $2 AND posts.parent = 0 ORDER BY posts.tree LIMIT $1)) ' +
                'ORDER BY posts.path',
                [context.limit, context.id],
            )
            client.release();
            return rows;
        }
        if(context.desc && !context.since){
            const { rows } = await client.query(
                'SELECT author, created, forum, id, isEdited, message, parent, thread FROM posts ' +
                'WHERE posts.thread=$2 AND ARRAY[posts.tree] && ' +
                '(SELECT ARRAY (SELECT posts.tree from posts WHERE posts.thread = $2 AND posts.parent = 0 ORDER BY posts.tree DESC LIMIT $1)) ' +
                'ORDER BY posts.tree DESC, posts.path',
                [context.limit, context.id],
            )
            client.release();
            return rows;
        }
        if(context.desc && context.since){
            const { rows } = await client.query(
                'SELECT author, created, forum, id, isEdited, message, parent, thread FROM posts ' +
                'WHERE posts.thread=$2 AND ARRAY[posts.tree] && ' +
                '(SELECT ARRAY (SELECT posts.tree from posts WHERE posts.thread = $2 AND posts.parent = 0 AND posts.path < lpad((SELECT posts.path FROM posts WHERE posts.id = $3),length(posts.path)) ORDER BY posts.tree DESC LIMIT $1)) ' +
                'ORDER BY posts.tree DESC, posts.path',
                [context.limit, context.id, context.since],
            )
            client.release();
            return rows;
        }
        const { rows } = await client.query(
            'SELECT author, created, forum, id, isEdited, message, parent, thread FROM posts ' +
            'WHERE posts.thread=$2 AND ARRAY[posts.tree] && ' +
            '(SELECT ARRAY (SELECT posts.tree from posts WHERE posts.thread = $2 AND posts.parent = 0 AND posts.path > lpad((SELECT posts.path FROM posts WHERE posts.id = $3),length(posts.path)) ORDER BY posts.tree LIMIT $1)) ' +
            'ORDER BY posts.tree, posts.path',
            [context.limit, context.id, context.since],
        )
        client.release();
        return rows;
    }
}


class PostsController{
    static async createPosts(post){
        const client = await fastify.pg.connect();
        const { rows } = await client.query(
            'INSERT INTO posts(author, created, forum, isEdited, message, parent, thread, level, tree, path) ' +
            'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING posts.id',
            [post.author, post.created, post.forum, post.isEdited, post.message, post.parent, post.thread, post.level, post.tree, post.path],
        )
        client.release();
        return rows[0].id;
    }

    static async getPostById(id){
        const client = await fastify.pg.connect();
        const { rows } = await client.query(
            'SELECT * FROM posts WHERE posts.id = $1',
            [id],
        )
        client.release();
        return rows;
    }

    static async modifyPost(post){
        const client = await fastify.pg.connect();
        await client.query(
            'UPDATE posts SET message=$1, isEdited=$2' +
            'WHERE posts.id = $3',
            [post.message, true, post.id],
        )
    }
}


class VotesController{
    static async getVoteBySlugOrIdAndNickname(vote){
        const client = await fastify.pg.connect();
        const { rows } = await client.query(
            'SELECT nickname, voice, thread FROM votes ' +
            'WHERE LOWER(votes.thread) = LOWER($1) AND LOWER(votes.nickname) = LOWER($2)',
            [vote.thread, vote.nickname],
        )
        client.release();
        return rows;
    }

    static async createVote(context){
        const client = await fastify.pg.connect();
        await client.query(
            'INSERT INTO votes(nickname, voice, thread) ' +
            'VALUES($1,$2,$3)',
            [context.nickname, context.voice, context.thread],
        )
        client.release();
    }

    static async modifyVote(context){
        const client = await fastify.pg.connect();
        await client.query(
            'UPDATE votes SET nickname=$1, voice=$2, thread=$3 ' +
            'WHERE LOWER(votes.thread) = LOWER($3)',
            [context.nickname, context.voice, context.thread],
        )
        client.release();
    }
}


class StatusController{
    static async getUserStatus(){
        const client = await fastify.pg.connect();
        const { rows } = await client.query(
            'SELECT COUNT(*) AS user FROM users'
        )
        client.release();
        rows[0].user = Number(rows[0].user);
        return rows[0];
    }

    static async getForumStatus(){
        const client = await fastify.pg.connect();
        const { rows } = await client.query(
            'SELECT COUNT(*) AS forum FROM forums'
        )
        client.release();
        rows[0].forum = Number(rows[0].forum);
        return rows[0];
    }

    static async getThreadStatus(){
        const client = await fastify.pg.connect();
        const { rows } = await client.query(
            'SELECT COUNT(*) AS thread FROM threads'
        )
        client.release();
        rows[0].thread = Number(rows[0].thread);
        return rows[0];
    }

    static async getPostStatus(){
        const client = await fastify.pg.connect();
        const { rows } = await client.query(
            'SELECT COUNT(*) AS post FROM posts'
        )
        client.release();
        rows[0].post = Number(rows[0].post);
        return rows[0];
    }
}

class ForumUsersController{
    static async getMatchFromUsersForum(context){
        const client = await fastify.pg.connect();
        const { rows } = await client.query(
            'SELECT nickname, forum FROM forum_users ' +
            'WHERE LOWER(nickname)=LOWER($1) AND LOWER(forum)=LOWER($2)',
            [context.nickname, context.forum],
        )
        client.release();
        return rows;
    }

    static async addUserToUsersForum(context){
        const client = await fastify.pg.connect();
        await client.query(
            'INSERT INTO forum_users(nickname, forum) ' +
            'VALUES($1,$2)',
            [context.nickname, context.forum],
        )
        client.release();
    }

    static async getUsersFromForum(context){
        const client = await fastify.pg.connect();
        if(context.desc && context.since) {
            const {rows} = await client.query(
                'SELECT users.about, users.email, users.fullname, users.nickname FROM forum_users ' +
                'JOIN users ON LOWER(forum_users.nickname)=LOWER(users.nickname) ' +
                'WHERE LOWER(forum_users.forum)=LOWER($1) AND LOWER(users.nickname COLLATE "C") < LOWER($3 COLLATE "C") ' +
                'ORDER BY LOWER(users.nickname) COLLATE "C" DESC ' +
                'LIMIT $2',
                [context.forum, context.limit, context.since],
            )
            client.release();
            return rows;
        }
        if(!context.desc && context.since) {
            const {rows} = await client.query(
                'SELECT users.about, users.email, users.fullname, users.nickname FROM forum_users ' +
                'JOIN users ON LOWER(forum_users.nickname)=LOWER(users.nickname) ' +
                'WHERE LOWER(forum_users.forum)=LOWER($1) AND LOWER(users.nickname COLLATE "C") > LOWER($3 COLLATE "C") ' +
                'ORDER BY LOWER(users.nickname) COLLATE "C" ASC ' +
                'LIMIT $2',
                [context.forum, context.limit, context.since],
            )
            client.release();
            return rows;
        }
        if(context.desc && !context.since) {
            const {rows} = await client.query(
                'SELECT users.about, users.email, users.fullname, users.nickname FROM forum_users ' +
                'JOIN users ON LOWER(forum_users.nickname)=LOWER(users.nickname) ' +
                'WHERE LOWER(forum_users.forum)=LOWER($1) ' +
                'ORDER BY LOWER(users.nickname) COLLATE "C" DESC ' +
                'LIMIT $2',
                [context.forum, context.limit],
            )
            client.release();
            return rows;
        }
        const {rows} = await client.query(
            'SELECT users.about, users.email, users.fullname, users.nickname FROM forum_users ' +
            'JOIN users ON LOWER(forum_users.nickname)=LOWER(users.nickname) ' +
            'WHERE LOWER(forum_users.forum)=LOWER($1) ' +
            'ORDER BY LOWER(users.nickname) COLLATE "C" ASC ' +
            'LIMIT $2',
            [context.forum, context.limit],
        )
        client.release();
        return rows;
    }
}







//TODO RUN SERVER
const start = async () => {
    try {
        await fastify.listen(5000, '0.0.0.0');
        fastify.log.info(`server listening on ${fastify.server.address().port}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
}
start();

