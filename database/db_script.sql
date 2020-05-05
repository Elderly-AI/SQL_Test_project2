CREATE TABLE IF NOT EXISTS users
(
    about   	text,
    email   	text,
    fullname 	text,
    nickname 	text
);

CREATE TABLE IF NOT EXISTS forums
(
    posts 	    integer,
    slug 	    text,
    threads 	integer,
    title	    text,
    username  	text
);

CREATE TABLE IF NOT EXISTS threads
(
    author	    text,
    created	    TIMESTAMP WITH TIME ZONE,
    forum	    text,
    id 		    SERIAL PRIMARY KEY,
    message	    text,
    slug	    text,
    title	    text,
    votes	    integer
);

CREATE TABLE IF NOT EXISTS posts
(
    author	    text,
    created	    TIMESTAMP WITH TIME ZONE,
    forum	    text,
    id		    SERIAL PRIMARY KEY,
    isEdited	boolean,
    message	    text,
    parent	    integer DEFAULT 0,
    thread	    integer,
    level	    integer,
    tree	    bigint,
    path	    text
);

CREATE TABLE IF NOT EXISTS votes
(
    nickname	text,
    thread	    text,
    voice	    integer
);

CREATE TABLE IF NOT EXISTS forum_users
(
    nickname	text,
    forum	    text
);